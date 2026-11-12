# Mion The Kargo Sipariş Performansı

Günlük Mion siparişlerini ve aylık toplamları gösteren GitHub Pages panosu.
Kapsam yalnızca **The Kargo'nun taşıdığı Mion siparişleri** olmalıdır.

## Mevcut durum

Sayfa `data/orders.json` dosyasından beslenir. Sayılar, aylık kartlar, filtreler,
grafik ve CSV aynı dosyadan hesaplanır. Sayfa açıkken beş dakikada bir ve tekrar
görünür olduğunda yeni sürümü kontrol eder. `Veriyi yenile` elle kontrol eder.

**Veri kaynağından otomatik aktarım henüz bağlı değildir.** Dosyada kullanıcının
paylaştığı 19 Ekim–10 Kasım 2026 geçmiş değerleri vardır; toplam 421 sipariş.
22 Ekim'in 5 siparişi dahildir. 25 Ekim, 1 Kasım ve 8 Kasım kapalı günlerdir.
Kaynak bağlantısı kurulana kadar bu geçmiş değerler ve bağlantı bekleme durumu
açıkça gösterilir. Sayfanın dosyayı kontrol etmesi BigQuery sorgusu çalıştırmaz.

12 Kasım 2026 erişim kontrolünde mevcut BigQuery hesabı `e-migros-bi` projesinde
`bigquery.jobs.create` izni vermedi. SmartOne veri aracı da kullanılabilir yanıt
vermedi. Migpack için doğrulanmış, otomasyona uygun API bağlantısı bulunmadı.
Bu nedenle sorgu, sürekli aktarım görevi veya başarılı kaynak güncellemesi varmış
gibi bir yapı oluşturulmadı. Kimlik bilgileri siteye eklenmedi.

## Bağlantı tamamlandığında

Yetkili bir sunucu veya bağlantısı doğrulanmış bir otomasyon:

1. Mion + The Kargo kapsamını ve sipariş tanımını doğrular.
2. İstanbul saatine göre tamamlanmış günleri sorgular. Başlangıç 19 Ekim 2026'dır.
3. Tüm günleri içeren dosyayı hazırlar. Eksik veri veya hata sıfır sipariş değildir.
4. Sipariş toplamlarını doğrular ve `data/orders.json` dosyasını tek işlemde günceller.
5. GitHub Pages dağıtımının başarıyla bitmesini doğrular.

Güncel veri yayınlanınca `source` değeri `bigquery` veya `migpack`, `source_state`
değeri `connected`, `updated_at` ise gerçek başarılı veri alımının saat dilimi içeren
ISO zamanı olmalıdır. Bu değerler yalnızca gerçek kaynak sorgusu başarıyla
tamamlandığında değiştirilmelidir. Kaynak hatasında son başarılı dosya korunur;
güncelleme zamanı ileri alınmaz.

## Veri sözleşmesi

- `schema_version`: `1`
- `scope`: `mion_the_kargo`
- `timezone`: `Europe/Istanbul`
- `source`: `shared_daily_values`, `bigquery` veya `migpack`
- `source_state`: `historical` veya `connected`
- `updated_at`: geçmiş veride `null`; bağlı kaynakta gerçek veri alım zamanı
- `period_start`, `period_end`: `YYYY-MM-DD`, tüm tamamlanmış günleri kapsar
- `days`: kesintisiz, tarihe göre günlük liste
- Her gün: `date`, `orders`, `status`
- `status: active`: pozitif tam sayı sipariş
- `status: no_orders`: doğrulanmış sıfır sipariş (`orders: 0`)
- `status: closed`: doğrulanmış kapalı gün (`orders: null`)

Sıfır siparişten deponun kapalı olduğu çıkarılamaz. Yeni günler için kapanış
bilgisi bilinmiyorsa `closed` kullanılmaz. Günlük ortalama, sipariş oluşan günler
üzerinden hesaplanır; açık gün sayısı olarak sunulmaz. Aylık değişim, o aylarda
gözlemlenen siparişli günlerin ortalamalarını karşılaştırır.

Kartlar boşken yükleme durumu gösterilir. Geçersiz kapsam, eksik/tekrar eden gün,
negatif sipariş veya tamamlanmamış gün dosyası reddedilir. Yenileme başarısızsa
son başarıyla alınan veriler korunur. Eski kaynak verisi için uyarı gösterilir.
