
# WMS Netsis Entegre (Express + SQLite + Netsis ERP Integration)

Bu proje, gönderdiğiniz örneğin **mantığını** (SQLite veritabanı, çoklu paket/alt barkod mantığı, sipariş → toplama → barkodla tamamlama, PDF irsaliye) temel alarak baştan **tam fonksiyonel** şekilde hazırlanmıştır.
Tek komutla ayağa kalkar ve tarayıcıdan kullanılabilir.

## Özellikler
- **Ürünler + Çoklu Paket/Alt Barkod**: Her ürün için sınırsız paket satırı; her paketin kendi barkodu ve set başına miktarı var.
- **Siparişler**: Ürünlerden kalemler eklenir.
- **Toplama (Picking)**: Sipariş için toplama başlatılır, kamera veya manuel barkod girişiyle paket barkodları okutulur.
  - Her ürün için **paketlerin quantity toplamı** = bir set. `order_items.quantity` kadar set tamamlandığında kalem biter.
  - Yanlış barkodda uyarı verir; doğru barkodda **başarı sesi**.
- **PDF İrsaliye**: Toplama sayfasından tek tıkla PDF oluşturulur (server tarafında).

## Kurulum
```bash
npm install
npm run migrate   # /backend/db/wms.db dosyasına şemayı uygular
npm run seed      # Örnek ürün+paket+sipariş verisi
npm run dev       # http://localhost:5000
```
Ardından tarayıcıda `http://localhost:5000` adresine gidin.

## Dizin Yapısı
```
backend/
  server.js         # API + statik frontend servisi
  db/
    schema.sql      # SQLite şeması (ürünler, paketler, siparişler, toplama, taramalar)
    migrate.js      # Şemayı uygular
    seed.js         # Örnek veri
public/
  index.html        # Dashboard
  products.html     # Ürün/Paket yönetimi
  orders.html       # Sipariş oluşturma/liste
  pick.html         # Toplama + kamera üzerinden barkod okuma
  assets/css/styles.css
package.json
README.md
```

## Notlar
- Kamera tarama için **@zxing/browser** CDN kullanıldı. Masaüstü tarayıcılarda ve mobil cihazlarda çalışır (kamera izinleri gerekir).
- PDF üretimi için **pdfkit** kullanıldı.
- Gerekirse Wix entegrasyonu için `server.js` içine `axios` tabanlı servisler eklenebilir (örn. `.env` ile WIX_API_KEY, WIX_SITE_ID), fakat bu proje **tamamen lokal** çalışır.

## Geliştirme İpuçları
- Çoklu paket mantığı: Bir ürünün paketleri toplandığında (ör. 3 paket = 1 set), `order_items.picked_qty` otomatik olarak set sayısına eşitlenir.
- Aynı paket barkodunu **gereğinden fazla** okutursanız backend engeller.
- Yanlış barkod “Bu barkod bu siparişte beklenmiyor” ile reddedilir.

## Lisans
MIT
