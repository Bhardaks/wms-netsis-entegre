const axios = require('axios');

class NetsisAPI {
  constructor() {
    this.baseURL = process.env.NETSIS_API_URL || 'http://localhost:7070/api/v2';
    this.username = process.env.NETSIS_USERNAME;
    this.password = process.env.NETSIS_PASSWORD;
    this.dbType = process.env.NETSIS_DB_TYPE || 'vtMSSQL';
    this.dbName = process.env.NETSIS_DB_NAME;
    this.dbUser = process.env.NETSIS_DB_USER;
    this.dbPassword = process.env.NETSIS_DB_PASSWORD;
    this.branchCode = parseInt(process.env.NETSIS_BRANCH_CODE) || 0;
    
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  // OAuth2 Authentication
  async authenticate() {
    try {
      console.log('🔐 Netsis kimlik doğrulama başlatılıyor...');
      
      const loginData = {
        BranchCode: this.branchCode,
        NetsisUser: this.username,
        NetsisPassword: this.password,
        DbType: this.dbType,
        DbName: this.dbName,
        DbUser: this.dbUser,
        DbPassword: this.dbPassword
      };

      const response = await axios.post(`${this.baseURL}/auth/login`, loginData, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.access_token) {
        this.accessToken = response.data.access_token;
        // Token süresi genelde 1 saat
        this.tokenExpiry = Date.now() + (response.data.expires_in || 3600) * 1000;
        
        console.log('✅ Netsis kimlik doğrulama başarılı');
        return true;
      }
      
      throw new Error('Invalid authentication response');
      
    } catch (error) {
      console.error('❌ Netsis kimlik doğrulama hatası:', error.response?.data || error.message);
      throw new Error(`Netsis authentication failed: ${error.message}`);
    }
  }

  // Token kontrolü ve yenileme
  async ensureAuthenticated() {
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      await this.authenticate();
    }
  }

  // API request wrapper
  async makeRequest(method, endpoint, data = null) {
    await this.ensureAuthenticated();
    
    try {
      const config = {
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      };

      if (data) {
        config.data = data;
      }

      const response = await axios(config);
      return response.data;
      
    } catch (error) {
      console.error(`❌ Netsis API Error [${method} ${endpoint}]:`, error.response?.data || error.message);
      
      // Token süresi dolmuşsa yeniden authenticate ol
      if (error.response?.status === 401) {
        this.accessToken = null;
        await this.authenticate();
        // Retry request
        return this.makeRequest(method, endpoint, data);
      }
      
      throw error;
    }
  }

  // Test bağlantısı
  async testConnection() {
    try {
      console.log('🔍 Netsis bağlantısı test ediliyor...');
      
      // Help endpoint'i public olabilir, test için kullanabiliriz
      const helpResponse = await axios.get(`${this.baseURL.replace('/api/v2', '')}/api/v2/help`);
      
      if (helpResponse.status === 200) {
        console.log('✅ Netsis REST servisi erişilebilir');
        
        // Authentication test
        await this.authenticate();
        
        // Basit bir GET request ile test
        const testResponse = await this.makeRequest('GET', '/ARPs?limit=1');
        console.log('✅ Netsis API bağlantısı ve kimlik doğrulama başarılı');
        
        return {
          success: true,
          message: 'Netsis bağlantısı başarılı',
          apiVersion: 'v2',
          sampleData: testResponse
        };
      }
      
    } catch (error) {
      console.error('❌ Netsis bağlantı testi başarısız:', error.message);
      return {
        success: false,
        message: `Netsis bağlantısı başarısız: ${error.message}`,
        error: error.response?.data || error.message
      };
    }
  }

  // Cari listesi (müşteriler)
  async getCustomers(limit = 100, offset = 0) {
    return this.makeRequest('GET', `/ARPs?limit=${limit}&offset=${offset}`);
  }

  // Ürün listesi
  async getProducts(limit = 100, offset = 0) {
    return this.makeRequest('GET', `/Items?limit=${limit}&offset=${offset}`);
  }

  // Stok kartları
  async getStockCards(limit = 100, offset = 0) {
    return this.makeRequest('GET', `/StockCards?limit=${limit}&offset=${offset}`);
  }

  // Sipariş listesi
  async getOrders(limit = 100, offset = 0) {
    return this.makeRequest('GET', `/Orders?limit=${limit}&offset=${offset}`);
  }

  // Tek müşteri getir
  async getCustomerById(customerId) {
    return this.makeRequest('GET', `/ARPs/${customerId}`);
  }

  // Tek ürün getir
  async getProductById(productId) {
    return this.makeRequest('GET', `/Items/${productId}`);
  }

  // Stok güncelleme
  async updateStock(stockId, stockData) {
    return this.makeRequest('PUT', `/StockCards/${stockId}`, stockData);
  }

  // Yeni sipariş oluştur
  async createOrder(orderData) {
    return this.makeRequest('POST', '/Orders', orderData);
  }

  // Sipariş güncelle
  async updateOrder(orderId, orderData) {
    return this.makeRequest('PUT', `/Orders/${orderId}`, orderData);
  }

  // SQL sorgusu çalıştır
  async executeQuery(sqlQuery, limit = 100) {
    const encodedQuery = encodeURIComponent(sqlQuery);
    return this.makeRequest('GET', `/Query?q=${encodedQuery}&limit=${limit}`);
  }
}

// Singleton instance
const netsisAPI = new NetsisAPI();

module.exports = {
  NetsisAPI,
  netsisAPI
};