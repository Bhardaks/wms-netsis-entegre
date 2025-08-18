# WMS Netsis Entegre - Depo Yönetim Sistemi + Netsis ERP Entegrasyonu

## Proje Konumu
`C:\Users\Irmak\wms-netsis-entegre\`

## Proje Açıklaması
Bu proje, tam fonksiyonel bir Warehouse Management System (WMS) ve gelecekteki Netsis ERP entegrasyonu için hazırlanan temel yapıyı içerir.

## Mevcut Özellikler

### 🔐 Kullanıcı Yönetimi & Güvenlik
- **Hiyerarşik İzin Sistemi**: Ana kategoriler ve alt kategoriler ile detaylı erişim kontrolü
- **Rol Tabanlı Yetkilendirme**: Admin, Operator, Service rolleri
- **Granüler SSH Kontrolü**: SSH servis alanında hangi bölümlere erişebileceğini belirleme
- **Oturum Yönetimi**: Secure session-based authentication

### 📦 Ürün & Envanter Yönetimi
- **Ürün Kataloğu**: SKU, barkod ve paket yönetimi
- **Çoklu Paket Sistemi**: Her ürün için farklı paket boyutları
- **Stok Takibi**: Real-time envanter durumu
- **Raf Yönetimi**: Fiziksel konum bazlı stok organizasyonu

### 🔧 SSH Servis Hub
- **Servis Talepleri**: Müşteri servis taleplerinin yönetimi
- **Paket Açma İstasyonu**: 3 farklı açma yöntemi
- **SSH Envanter**: SSH-01-01 alanı stok takibi
- **Transfer İşlemleri**: SSH alanından servis taleplerini transfer

### 📱 Mobil Uyumlu Arayüz
- **Zebra Terminal Desteği**: Barkod tarayıcıları ile uyumlu
- **Responsive Design**: Tüm cihazlarda çalışır
- **Auto-processing**: Otomatik barkod işleme

## Veritabanı Yapısı
- **SQLite**: Hafif ve hızlı veritabanı
- **users**: Kullanıcı bilgileri ve roller
- **role_permissions**: Hiyerarşik izin sistemi
- **products**: Ürün kataloğu
- **service_requests**: Servis talepleri
- **ssh_inventory**: SSH alan envanteri

## API Endpoints
- `/api/auth/*` - Kimlik doğrulama
- `/api/users` - Kullanıcı yönetimi
- `/api/role-permissions` - İzin yönetimi
- `/api/products` - Ürün yönetimi
- `/api/service-requests` - Servis talepleri
- `/api/ssh-inventory` - SSH envanter

## Başlatma Komutları
```bash
cd "C:\Users\Irmak\wms-netsis-entegre"
node backend/server.js  # Server başlat (http://localhost:5000)
```

## Varsayılan Giriş Bilgileri
- **Kullanıcı**: admin
- **Şifre**: 18095

## Gelecek Geliştirmeler
- Netsis ERP API entegrasyonu
- Otomatik stok senkronizasyonu
- Gelişmiş raporlama sistemi
- Mobil uygulama desteği

## Teknik Notlar
- Node.js + Express backend
- Vanilla JavaScript frontend
- bcryptjs ile şifre hashleme
- express-session ile oturum yönetimi
- SQLite3 veritabanı

## Güvenlik
- Tüm API endpoint'leri session kontrolü ile korunur
- Şifreler bcrypt ile hashlenr
- XSS ve injection saldırılarına karşı koruma
- Role-based access control (RBAC)