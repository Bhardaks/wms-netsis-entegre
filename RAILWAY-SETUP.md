# 🚂 Railway.app Deployment Setup Guide

## Environment Variables Configuration

Railway projenizde aşağıdaki environment variables'ları ekleyin:

### 🔑 Netsis API Configuration
```bash
NETSIS_API_URL=http://93.89.67.130:2626
NETSIS_USERNAME=NETSIS
NETSIS_PASSWORD=141
NETSIS_DB_TYPE=vtMSSQL
NETSIS_DB_NAME=ZDENEME
NETSIS_DB_USER=TEMELSET
NETSIS_DB_PASSWORD=
NETSIS_BRANCH_CODE=0
```

### 🛡️ Security Configuration
```bash
SESSION_SECRET=wms-netsis-production-secret-2024-change-this
NODE_ENV=production
PORT=5000
```

## 🔧 Railway Setup Steps

### 1. Project Import
GitHub repository'yi Railway'e import edin

### 2. Environment Variables Setup ⚠️ KRİTİK
Railway dashboard → Settings → Environment → Variables'a bu değerleri **AYNEN** ekleyin:

**Variable Name** → **Value**
```
NETSIS_API_URL → http://93.89.67.130:2626
NETSIS_USERNAME → NETSIS  
NETSIS_PASSWORD → 141
NETSIS_DB_TYPE → vtMSSQL
NETSIS_DB_NAME → ZDENEME
NETSIS_DB_USER → TEMELSET
NETSIS_DB_PASSWORD → (boş bırakın)
NETSIS_BRANCH_CODE → 0
SESSION_SECRET → wms-netsis-production-secret-2024-change-this
NODE_ENV → production
RAILWAY_ENVIRONMENT → true
```

### 3. Build & Deploy
- Railway otomatik olarak `npm install` ve migration çalıştırır
- Deploy tamamlandıktan sonra health check yapın

### 4. Verification
Deploy sonrası mutlaka test edin:
- Health Check: `https://your-app.railway.app/api/netsis/test`
- Environment variables'ları kontrol edin

## 🩺 Health Check URLs

Deploy edildikten sonra bu URL'leri test edin:

- **Main Health Check**: `https://your-app.railway.app/api/netsis/test`
- **Debug Panel**: `https://your-app.railway.app/netsis-debug.html`
- **App Root**: `https://your-app.railway.app/`

## 🚨 Common Issues & Solutions

### 1. Environment Variables Missing ⚠️ EN YAYGINI
**Problem**: Health check shows `MISSING` environment variables
**Symptoms**: 
- `username=undefined&password=undefined` in logs
- `404 Not Found` from Netsis API
- All auth endpoints fail

**Solution**: 
1. Railway dashboard → Project → Settings → Environment
2. **Variables** sekmesine tıklayın
3. Her bir variable'ı **tek tek** ekleyin:
   - Variable name: `NETSIS_API_URL` 
   - Variable value: `http://93.89.67.130:2626`
4. **Deploy** butonuna tıklayıp yeniden deploy edin
5. Health check ile doğrulayın: `/api/netsis/test`

### 2. Network Connectivity Failed
**Problem**: `Network connectivity failed` error
**Solution**: 
- Netsis server `93.89.67.130:2626` erişilebilir olduğunu doğrulayın
- Railway'in external connections'ları desteklediğini kontrol edin

### 3. Authentication Failed
**Problem**: `Netsis authentication failed`
**Solutions**:
- Username/password doğruluğunu kontrol edin
- Database credentials'larını kontrol edin
- NTLM authentication gerekiyorsa debug log'ları inceleyin

### 4. HTTPS/HTTP Mixed Content
**Problem**: Railway HTTPS, Netsis HTTP kullanıyor
**Solution**: Mixed content security policy ayarları

## 🔍 Debug Commands

Railway console'dan çalıştırabilirsiniz:

```bash
# Environment variables kontrol
env | grep NETSIS

# Network connectivity test
curl -v http://93.89.67.130:2626

# Application logs
railway logs

# Service restart
railway redeploy
```

## 📊 Monitoring

Health check endpoint'ini monitoring için kullanın:
- **Healthy**: HTTP 200, status: "HEALTHY"
- **Degraded**: HTTP 200, status: "DEGRADED" 
- **Unhealthy**: HTTP 500, status: "UNHEALTHY"

## 🔧 Local Testing

Deploy etmeden önce local'de test edin:

```bash
# Environment variables set edin
cp .env.example .env
# .env dosyasını düzenleyin

# Server başlatın
npm start

# Health check test edin
curl http://localhost:5000/api/netsis/test

# Debug panel açın
open http://localhost:5000/netsis-debug.html
```

## 🚀 Deployment Checklist

- [ ] GitHub repository güncel
- [ ] Railway environment variables eklendi
- [ ] .env dosyası .gitignore'da (güvenlik)
- [ ] Health check çalışıyor
- [ ] Netsis connectivity test edildi
- [ ] Production logs kontrol edildi

## 📞 Support

Sorun devam ederse:
1. Railway logs'unu kontrol edin
2. `/netsis-debug.html` sayfasını açın
3. Health check JSON response'unu inceleyin
4. Network ve authentication check'lerini çalıştırın