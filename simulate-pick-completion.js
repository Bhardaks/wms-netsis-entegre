// Simulate pick completion for testing
const axios = require('axios');

async function simulatePickCompletion(orderId) {
  try {
    console.log(`🔧 Simulating pick completion for order ID: ${orderId}`);
    
    // Login first
    const loginResponse = await axios.post('http://localhost:5000/api/auth/login', {
      username: 'admin',
      password: '18095'
    });
    
    const cookies = loginResponse.headers['set-cookie'];
    const cookieHeader = cookies.map(cookie => cookie.split(';')[0]).join('; ');
    
    console.log('✅ Logged in successfully');
    
    // Get order details
    const orderResponse = await axios.get(`http://localhost:5000/api/orders`, {
      headers: { 'Cookie': cookieHeader }
    });
    
    const order = orderResponse.data.find(o => o.id == orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }
    
    console.log(`📦 Order found: ${order.order_number} with ${order.items.length} items`);
    order.items.forEach(item => {
      console.log(`   - ${item.sku}: qty=${item.quantity}, picked=${item.picked_qty}`);
    });
    
    // Create a simple admin endpoint to mark order as completed
    const completeResponse = await axios.post(`http://localhost:5000/api/admin/simulate-order-completion`, {
      order_id: orderId
    }, {
      headers: { 
        'Cookie': cookieHeader,
        'Content-Type': 'application/json'
      }
    });
    
    if (completeResponse.data.success) {
      console.log('✅ Order marked as completed');
      
      // Now try to create dispatch note
      const dispatchResponse = await axios.post(`http://localhost:5000/api/orders/${orderId}/convert-to-dispatch`, {}, {
        headers: { 
          'Cookie': cookieHeader,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('📋 Dispatch note result:', dispatchResponse.data);
      
    } else {
      console.log('❌ Failed to mark order as completed');
    }
    
  } catch (error) {
    console.error('❌ Simulation error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Run simulation for order 39
simulatePickCompletion(39);