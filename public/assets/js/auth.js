// Authentication utilities for WMS pages

// API endpoints
window.AuthAPI = {
  checkAuth: () => fetch('/api/auth/check', { credentials: 'include' }).then(r => r.json()),
  logout: () => fetch('/api/auth/logout', { 
    method: 'POST', 
    credentials: 'include' 
  }).then(r => r.json()),
  getRolePermissions: (role) => fetch(`/api/role-permissions/${role}`, { credentials: 'include' }).then(r => r.json())
};

// Dynamic role permissions (will be loaded from server)
window.ROLE_PERMISSIONS = {};

// Load role permissions dynamically
window.loadRolePermissions = async function(role) {
  console.log('*** WINDOW VERSION: loadRolePermissions START ***');
  
  // For now, just use default permissions to test
  const defaults = getDefaultPermissions(role);
  window.ROLE_PERMISSIONS[role] = defaults;
  console.log('*** Setting default permissions for role:', role, defaults);
  
  return defaults;
};

// Also create regular function version
async function loadRolePermissions(role) {
  console.log('*** REGULAR VERSION: loadRolePermissions START ***');
  return await window.loadRolePermissions(role);
}

// Default permissions as fallback
function getDefaultPermissions(role) {
  const defaults = {
    admin: ['products', 'orders', 'shelf', 'service', 'system'],
    operator: ['products', 'orders', 'shelf'],
    service: ['service']
  };
  return defaults[role] || [];
}

// Check if user has permission for current page
function hasPagePermission(userRole, pageName) {
  const permissions = window.ROLE_PERMISSIONS[userRole] || [];
  
  const pagePermissionMap = {
    'products.html': ['products'],
    'orders.html': ['orders'],
    'shelf-scanner.html': ['shelf'],
    'shelf-locations.html': ['shelf'],
    'shelf-admin.html': ['shelf'],
    'shelf-transfer.html': ['shelf'],
    'shelf-manager.html': ['shelf'],
    'inventory-count.html': ['shelf'],
    'stock-management.html': ['shelf'],
    'service-request.html': ['service'],
    'service-dashboard.html': ['service'],
    'ssh-inventory.html': ['service'],
    'package-opening.html': ['service'],
    'admin-panel.html': ['system'],
    'role-management.html': ['system']
  };
  
  const requiredPermissions = pagePermissionMap[pageName];
  console.log(`Page: ${pageName}, Role: ${userRole}, User Permissions:`, permissions, 'Required:', requiredPermissions);
  
  if (!requiredPermissions) {
    return true; // Allow access to pages not in the map
  }
  
  const hasPermission = requiredPermissions.some(perm => permissions.includes(perm));
  console.log(`Permission check result: ${hasPermission}`);
  return hasPermission;
}

// Get current page name from URL
function getCurrentPageName() {
  const path = window.location.pathname;
  return path.split('/').pop() || 'index.html';
}

// Main authentication check function
window.checkPageAuthentication = async function() {
  console.log('=== checkPageAuthentication called ===');
  try {
    console.log('1. Calling AuthAPI.checkAuth()...');
    const authCheck = await window.AuthAPI.checkAuth();
    console.log('2. AuthAPI.checkAuth() response:', authCheck);
    
    if (!authCheck.authenticated) {
      console.log('3. User not authenticated, redirecting to login');
      window.location.href = '/login.html';
      return false;
    }
    
    console.log('4. User authenticated:', authCheck.user);
    console.log('5. About to call loadRolePermissions for role:', authCheck.user.role);
    
    // Test if loadRolePermissions function exists
    console.log('5.1. loadRolePermissions function:', typeof loadRolePermissions);
    
    // Load dynamic role permissions
    console.log('5.2. Calling loadRolePermissions...');
    const permissions = await loadRolePermissions(authCheck.user.role);
    console.log('5.3. loadRolePermissions returned:', permissions);
    
    console.log('6. loadRolePermissions completed');
    
    // Check page-specific permissions
    const currentPage = getCurrentPageName();
    console.log('7. Checking permissions for page:', currentPage);
    
    if (!hasPagePermission(authCheck.user.role, currentPage)) {
      alert('Bu sayfaya erişim yetkiniz yok.');
      window.location.href = '/index.html';
      return false;
    }
    
    console.log('8. Permission check passed');
    
    // Add user info to page if header exists
    addUserInfoToHeader(authCheck.user);
    
    console.log('9. checkPageAuthentication completed successfully');
    
    // Sayfa özel callback fonksiyonu varsa çağır
    if (typeof window.onAuthCompleted === 'function') {
      console.log('10. Calling page-specific onAuthCompleted callback...');
      window.onAuthCompleted();
    }
    
    return authCheck.user;
  } catch (error) {
    console.error('Auth check error:', error);
    window.location.href = '/login.html';
    return false;
  }
};

// Add user info to page header
function addUserInfoToHeader(user) {
  // Check if there's already a header with brand
  let header = document.querySelector('header');
  if (!header) {
    // Create header if it doesn't exist
    header = document.createElement('header');
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background: rgba(11,18,32,0.95);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid #4da3ff;
      position: sticky;
      top: 0;
      z-index: 100;
    `;
    document.body.insertBefore(header, document.body.firstChild);
  }
  
  // Check if user info already exists
  if (header.querySelector('.header-user')) {
    return;
  }
  
  // Add user info section
  const userSection = document.createElement('div');
  userSection.className = 'header-user';
  userSection.innerHTML = `
    <div class="user-info" style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #111a2e; border-radius: 8px; border: 1px solid #1f2a44;">
      <span class="user-name" style="font-weight: 600; color: #e5eefc; font-size: 14px;">
        ${user.full_name || user.username}
      </span>
      <span class="user-role" style="font-size: 12px; color: #93a4bd; background: #122443; padding: 2px 8px; border-radius: 12px; border: 1px solid #1f2a44;">
        ${getRoleDisplayName(user.role)}
      </span>
      <button class="logout-btn" onclick="handleLogout()" style="background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer;">
        Çıkış
      </button>
    </div>
  `;
  
  header.appendChild(userSection);
}

function getRoleDisplayName(role) {
  const roleNames = {
    admin: 'Yönetici',
    operator: 'Operatör',
    service: 'Servis Teknisyeni'
  };
  return roleNames[role] || role;
}

// Global logout handler
window.handleLogout = async function() {
  try {
    await window.AuthAPI.logout();
    window.location.href = '/login.html';
  } catch (error) {
    console.error('Logout error:', error);
    window.location.href = '/login.html';
  }
};

// Auto-initialize authentication on page load
document.addEventListener('DOMContentLoaded', () => {
  // Skip authentication for login page
  if (getCurrentPageName() === 'login.html') {
    return;
  }
  
  window.checkPageAuthentication();
});