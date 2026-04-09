>for those coming from my other projects, this is my math project that i will *probably* not update further.
# U-Ma(th)

U-MAt(hematics), sevilen kart oyunu UNO'nun kuralları ile rekabetçi matematik çözme dinamiklerini birleştiren, gerçek zamanlı, çok oyunculu çevrimiçi bir web oyunudur.

## Oynanış

Her oyuncu oyuna **200 HP**(sağlık puanı) ile başlar. Eldeki kartlardan biri oynanarak oyun sürdürülür. Kartı oynayan dahil olmak üzere tüm oyuncular, kartın belirlediği matematik sorusunu süre bitmeden doğru çözmek zorundadır. Soruyu yanlış cevaplayanlar veya süre bitmeden çözemeyenler kartın hasar puanını (HP) kaybeder.

### Temel Kurallar
- **Renk ve Numara:** Oyuncuların sırası geldiğinde masadaki son kartın **rengiyle (Kırmızı, Mavi, Yeşil)** veya **numarasıyla (0-9)** eşleşen bir kart atmaları gerekir.
- **Kart Çekme (Havuz):** Oynanabilecek uygun bir kart yoksa yedek havuzdan (pool) 1 kart çekilir ve sıra bir sonraki oyuncuya geçer. Havuzdaki kartlar bitince, oynanmış kartlarla otomatik olarak yeni bir havuz oluşturulur.
- **Herkes Çözer:** Atılan her soru kartındaki problemi sadece atan kişi değil, odadaki **tüm oyuncular** çözmekle yükümlüdür.

### Kart Türleri
Soru kartları, matematikteki konularına göre ayrılır (Euler, Pisagor, Limit vb.) ve her birinin farklı hasar değerleri vardır.

Zorluk seviyeleri, kartın sağladığı aksiyona göre özel tipte olabilir:
- **Normal:** Standart soru kartı.
- **Skip (Atla):** Bir sonraki oyuncunun turunu atlar. 2 kişilik maçlarda ekstra tur hakkı kazandırır.
- **Reverse (Yön Değiştir):** Oyunun oynanış sırasını tersine çevirir. 2 kişilik maçlarda ekstra tur hakkı verir.
- **Draw 2 (2 Çek):** Sonraki oyuncuya biri `zor`, biri `orta` seviyeden 2 özel soru kartı çektirir.
- **Draw 4 (4 Çek):** Sonraki oyuncuya biri `zor`, biri `orta` olan 2 gizli kart ile havuzdan 2 rastgele kart olmak üzere 4 kart çektirir. Havuz ve renk kurallarını yok sayar. Çok nadir bulunur.

### Joker Kartları (Wild Cards)
Masadaki renk ve numaradan bağımsız olarak her an oynanabilir ve oyunun kurallarını anında değiştirirler. Oynandıklarında oyuncu yeni rengi rastgele belirlemiş olur ve jokerler **soru turu başlatmaz**, direkt olarak anlık etki sağlar:
- ⚡ **Şimşek:** Bir sonraki anlık oyuncuya hedef gözetmeden anında **25 Net Hasar** (HP) verir.
- 💚 **İyileşme:** Kartı kullanan oyuncuya **30 HP** kazandırır (Maksimum 200 HP sınırı ile).
- 🔥 **Çift Hasar:** Odada oynanacak olan *bir sonraki matematik sorusunun* (veya Şimşek kartının) vereceği tüm hasarı 2'ye katlar. Üst üste oynanması durumunda çarpan katlanarak birikir (2x, 4x, 8x...). İyileşme ve Hırsız jokerleri bu çarpanı tüketmez.
- 🤏 **Hırsız:** Bir sonraki oyuncunun elinden **rastgele 1 kart çalarak** sizin elinize ekler.

---

## Teknik Özellikler

Oyun, düşük gecikme ve tam dinamiklik ön planda tutularak tasarlanmıştır.

### Mimari ve Altyapı
- **Node.js & Express:** Hızlı, modern ve asenkron sunucu altyapısı.
- **Socket.IO:** Odalar (Rooms) üzerinden düşük gecikmeli, %100 gerçek zamanlı (real-time) soket mimarisi. Veriler saniyesinde senkronize edilir.
- **Canlı Lobi ve Gizli Odalar:** Ana ekranda bekleyen açık odalar (Lobby Browser) yeni gelen oyunculara eş zamanlı olarak yayınlanır. İsteyen oyuncular "Gizli Oda" seçeneğiyle sadece kod ile erişilebilen oyunlar da kurabilir.
- **Modüler Soru Havuzu:** Sisteme dinamik bir soru okuma motoru eşlik eder. `/questions/` dizinini otomatik izler, yeni klasör veya `JSON` eklendiğinde anında oyuna entegre eder. Sorular görsel (PNG) kullanılabileceği gibi, JSON içerisine eklenen özel `text` alanı sayesinde **salt metin (görselsiz)** sorular da tam olarak desteklenir.

### Gelişmiş Algoritmalar
- **Dinamik Soru Süreleri:** Matematik sorularını çözmek için verilen saniye kısıtlamaları sabit değildir, kartın zorluğuna göre dinamik hesaplanır (Kolay: 1dk 40sn, Orta: 2dk 10sn, Zor: 2dk 40sn).
- **Dinamik UNO Numaralandırması:** `maxNumber = Math.floor(Math.sqrt(totalQuestions))` gibi özel bir algoritma kullanır. Yani oyuna ne kadar soru eklenirse (Örn: 9 soru için max sayı 3 iken, 81 soruda tam numaralandırma 9'a çıkar) sayı eşleşmeleri zorluğu kendini otomatik dengeler.
- **Havuz & Bellek (Pool System):** Dizi-bellek yönetimi (Garbage generation) engellenmiş, optimize edilmiş bir Fisher-Yates karıştırma ve havuz motoruna sahiptir.

### Kullanıcı Deneyimi ve Arayüz
- **Karalama Defteri (Canvas):** Kullanıcıların yanlarında kâğıt kalem olmadan problemleri çözebilmesi için geliştirilen, renk ve boyut seçenekleriyle gelen `Fabric.js` destekli çizim tahtası. Geometri çözümlerini kolaylaştırmak amacıyla ince bir milimetrik defter dokusuna sahiptir ve her yeni soruda otomatik olarak temizlenir.
- **Mikro Etkileşimler (Juiciness):** Hatalı oynanan kartlardaki sarsıntı animasyonları (Card shake), süresi azaldıkça tehlikeye göre sarı ve kırmızı renge bürünüp nabız gibi atan (Pulsing) renkli zamanlayıcılar ve sırası gelen oyuncuyu neon aura ile izole eden sistemlerle maksimum "oyun hissiyatı" (Game Feel) sağlar.
- **Klavye Yönetimi:** Hızlı oynamak isteyen oyuncular için şıkların (`A, B, C, D`) ve numaraların (`1-9`) klavye makrolarına atanmasıyla masadaki eylemler farenin yanı sıra klavye ile de saniyesinde yönetilebilir.
- **Cam Tasarım:** Saf (Vanilla) CSS ile tasarlanmış modern, yarı saydam arayüz. Telefonlarda (dar ekranlarda) yatay kaydırılabilen (momentum scroll) destekli esnek el kartları ve okunabilirliğe göre tek sütuna indirgenen mobil tasarıma (Responsive Flexbox/Grid) sahiptir.
- **Teknik Optimizasyonlar:** Seri tıklamalardan kaynaklı sunucu hatalarını önlemek için butonlara **Anti-Spam (Debounce)** gecikmesi eklenmiştir. Ayrıca, resimli sorular oyun başlar başlamaz arka planda sessizce istemcinin önbelleğine (Cache) yüklenir ve sorular ekrana *sıfır bekleme süresiyle* yansır.
- **Sentezlenmiş Ses Motoru (Web Audio API):** Sunucuyu/İstemciyi yavaşlatacak `MP3` veya `WAV` gibi hiçbir dış ses dosyası **kullanılmamıştır**. Özel `sounds.js` motoru sayesinde tarayıcının osilatörünü kullanarak saf frekanslardan sıfır-boyut efektler çıkartılır (Zamanlayıcı biplemesi, hata sesi, kart atma rüzgarı vs.).

## Nasıl Çalıştırılır?

1. Bağımlılıkları Kurun:
```bash
npm install
```

2. Sunucuyu Başlatın:
```bash
node server.js
```

3. Görüntüleyin:
Tarayıcınızı açıp `http://localhost:3000` veya `http://ipv4:3000` adresine gidebilirsiniz. Oyunu kendi bilgisayarınızda denerken 2 veya daha fazla sekme açarak sistemi odaya davet ederek test edebilirsiniz.
