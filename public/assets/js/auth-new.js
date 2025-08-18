// NEW Authentication utilities for WMS pages

// API endpoints
window.AuthAPI = {
  checkAuth: () => fetch('/api/auth/check', { credentials: 'include' }).then(r => r.json()),
  logout: () => fetch('/api/auth/logout', { 
    method: 'POST', 
    credentials: 'include' 
  }).then(r => r.json()),
  getRolePermissions: (role) => fetch(`/api/role-permissions/${role}`, { credentials: 'include' }).then(r => r.json())
};

// Dynamic role permissions
window.ROLE_PERMISSIONS = {};

// Default permissions
function getDefaultPermissions(role) {
  const defaults = {
    admin: ['products', 'orders', 'shelf', 'service', 'system'],
    operator: ['products', 'orders', 'shelf'],
    service: ['service']
  };
  return defaults[role] || [];
}

// Load role permissions - SUPER SIMPLE VERSION
window.loadRolePermissions = async function(role) {
  console.log('NEW FILE: *** SUPER SIMPLE START ***');
  
  // Just return default permissions for now
  const defaults = ['products', 'orders', 'shelf', 'service', 'system'];
  window.ROLE_PERMISSIONS[role] = defaults;
  
  console.log('NEW FILE: *** SUPER SIMPLE END - returning:', defaults);
  return defaults;
};

// Check page permissions - Updated for hierarchical permissions
function hasPagePermission(userRole, pageName) {
  const permissions = window.ROLE_PERMISSIONS[userRole] || [];
  
  // Detailed subcategory permission mapping
  const pagePermissionMap = {
    'role-management.html': ['system', 'system.manage_roles', 'system.manage_permissions'],
    'admin-panel.html': ['system', 'system.admin_panel', 'system.manage_users'],
    'products.html': ['products', 'products.view', 'products.create', 'products.edit'],
    'orders.html': ['orders', 'orders.view', 'orders.create', 'orders.edit'],
    // SSH Servis - Alt bölüm bazında kontrol (ana 'service' iznini kaldırdık)
    'service-request.html': ['service.requests', 'service.create'], // Sadece servis talepleri alt izni
    'service-dashboard.html': ['service.dashboard', 'service.view'], // Sadece dashboard alt izni  
    'ssh-inventory.html': ['service.ssh_inventory', 'service.inventory'], // Sadece SSH envanter alt izni
    'shelf-scanner.html': ['shelf', 'shelf.scanner', 'shelf.assign'],
    'shelf-locations.html': ['shelf', 'shelf.locations', 'shelf.view'],
    'shelf-admin.html': ['shelf', 'shelf.admin', 'shelf.manage'],
    'shelf-transfer.html': ['shelf', 'shelf.transfer', 'shelf.move'],
    'inventory-count.html': ['shelf', 'shelf.inventory', 'shelf.count'],
    'stock-management.html': ['shelf', 'shelf.stock', 'shelf.analytics']
  };
  
  const required = pagePermissionMap[pageName];
  console.log('NEW FILE: Permission check - Page:', pageName);
  console.log('NEW FILE: User permissions:', permissions);
  console.log('NEW FILE: Required permissions:', required);
  
  if (!required) {
    console.log('NEW FILE: No requirements for this page, allowing access');
    return true;
  }
  
  // Check if user has any of the required permissions (including subcategories)
  const hasPermission = required.some(perm => {
    const hasThisPermission = permissions.includes(perm);
    console.log(`NEW FILE: Checking permission '${perm}': ${hasThisPermission}`);
    return hasThisPermission;
  });
  
  console.log('NEW FILE: Final permission result:', hasPermission);
  return hasPermission;
}

// Get current page name
function getCurrentPageName() {
  const path = window.location.pathname;
  return path.split('/').pop() || 'index.html';
}

// Main auth check
window.checkPageAuthentication = async function() {
  console.log('NEW FILE: === checkPageAuthentication called ===');
  
  try {
    const authCheck = await window.AuthAPI.checkAuth();
    console.log('NEW FILE: Auth check response:', authCheck);
    
    if (!authCheck.authenticated) {
      window.location.href = '/login.html';
      return false;
    }
    
    console.log('NEW FILE: User authenticated, loading permissions...');
    console.log('NEW FILE: About to call loadRolePermissions for:', authCheck.user.role);
    console.log('NEW FILE: loadRolePermissions function exists:', typeof window.loadRolePermissions);
    
    // INLINE API CALL - Direct API call without function
    console.log('NEW FILE: Making direct API call for permissions...');
    try {
      const apiResponse = await fetch(`/api/role-permissions/${authCheck.user.role}`, { credentials: 'include' });
      console.log('NEW FILE: API response status:', apiResponse.status);
      
      if (apiResponse.ok) {
        const result = await apiResponse.json();
        console.log('NEW FILE: API result:', result);
        
        if (result && result.success) {
          const enabledPermissions = Object.entries(result.permissions)
            .filter(([permission, enabled]) => enabled)
            .map(([permission]) => permission);
          
          window.ROLE_PERMISSIONS[authCheck.user.role] = enabledPermissions;
          console.log('NEW FILE: Dynamic permissions loaded:', enabledPermissions);
        } else {
          // Fallback to defaults
          const defaultPermissions = ['products', 'orders', 'shelf', 'service', 'system'];
          window.ROLE_PERMISSIONS[authCheck.user.role] = defaultPermissions;
          console.log('NEW FILE: Using fallback permissions:', defaultPermissions);
        }
      } else {
        console.error('NEW FILE: API error:', apiResponse.status);
        // Fallback to defaults
        const defaultPermissions = ['products', 'orders', 'shelf', 'service', 'system'];
        window.ROLE_PERMISSIONS[authCheck.user.role] = defaultPermissions;
        console.log('NEW FILE: Using fallback permissions after error:', defaultPermissions);
      }
    } catch (error) {
      console.error('NEW FILE: Exception during API call:', error);
      // Fallback to defaults
      const defaultPermissions = ['products', 'orders', 'shelf', 'service', 'system'];
      window.ROLE_PERMISSIONS[authCheck.user.role] = defaultPermissions;
      console.log('NEW FILE: Using fallback permissions after exception:', defaultPermissions);
    }
    
    const currentPage = getCurrentPageName();
    if (!hasPagePermission(authCheck.user.role, currentPage)) {
      alert('Bu sayfaya erişim yetkiniz yok.');
      window.location.href = '/index.html';
      return false;
    }
    
    console.log('NEW FILE: Auth check completed successfully');
    return authCheck.user;
  } catch (error) {
    console.error('NEW FILE: Auth check error:', error);
    window.location.href = '/login.html';
    return false;
  }
};

// Logout handler
window.handleLogout = async function() {
  try {
    await window.AuthAPI.logout();
    window.location.href = '/login.html';
  } catch (error) {
    console.error('Logout error:', error);
    window.location.href = '/login.html';
  }
};

console.log('NEW AUTH FILE LOADED SUCCESSFULLY');