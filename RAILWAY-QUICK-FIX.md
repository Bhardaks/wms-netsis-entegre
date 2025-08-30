# 🚨 Railway Deployment Quick Fix

## Problem: username=undefined&password=undefined

Railway'de deploy başarılı ama Netsis bağlanamıyor çünkü environment variables eksik!

## ⚡ Hızlı Çözüm

### 1. Railway Dashboard'a Git
- Railway.app → Project → Settings → Environment

### 2. Variables Ekle (Tek Tek!)
```
NETSIS_API_URL = http://93.89.67.130:2626
NETSIS_USERNAME = NETSIS
NETSIS_PASSWORD = 141  
NETSIS_DB_TYPE = vtMSSQL
NETSIS_DB_NAME = ZDENEME
NETSIS_DB_USER = TEMELSET
NETSIS_DB_PASSWORD = (boş bırak)
NETSIS_BRANCH_CODE = 0
SESSION_SECRET = wms-netsis-production-secret-2024
NODE_ENV = production
RAILWAY_ENVIRONMENT = true
```

### 3. Redeploy
- "Deploy" butonuna bas
- 2-3 dakika bekle

### 4. Test Et
- Health Check: https://wms-netsis-entegre.railway.app/api/netsis/test
- Netsis credentials artık gelecek

## ✅ Başarı Sinyalleri
```json
{
  "checks": {
    "env_vars": {
      "details": {
        "NETSIS_USERNAME": "NETSIS",     // ← ARTIK "MISSING" DEĞİL
        "NETSIS_PASSWORD": "PRESENT",    // ← ARTIK "MISSING" DEĞİL  
        "NETSIS_DB_NAME": "ZDENEME"      // ← ARTIK "MISSING" DEĞİL
      }
    }
  }
}
```

## 🔄 Eğer Hala Sorun Varsa
1. Railway → Settings → Environment → Variables'ı kontrol et
2. Her variable'ın doğru yazıldığını kontrol et
3. Tekrar deploy et
4. Logs'u kontrol et: Railway dashboard → Deployments → View Logs