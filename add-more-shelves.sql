-- Daha fazla raf tanımlama
-- Sizin depo düzeninize göre özelleştirin

-- A Bölgesi rafları (devamı)
INSERT OR IGNORE INTO shelves (shelf_code, shelf_name, zone, aisle, level, capacity) VALUES
-- A Bölgesi 3. Koridor
('A3-01', 'A Bölgesi 3. Koridor Seviye 1', 'A', '3', 1, 100),
('A3-02', 'A Bölgesi 3. Koridor Seviye 2', 'A', '3', 2, 100),
('A3-03', 'A Bölgesi 3. Koridor Seviye 3', 'A', '3', 3, 100),

-- A Bölgesi 4. Koridor  
('A4-01', 'A Bölgesi 4. Koridor Seviye 1', 'A', '4', 1, 100),
('A4-02', 'A Bölgesi 4. Koridor Seviye 2', 'A', '4', 2, 100),

-- B Bölgesi rafları (devamı)
('B1-03', 'B Bölgesi 1. Koridor Seviye 3', 'B', '1', 3, 100),
('B2-02', 'B Bölgesi 2. Koridor Seviye 2', 'B', '2', 2, 100),
('B2-03', 'B Bölgesi 2. Koridor Seviye 3', 'B', '2', 3, 100),
('B3-01', 'B Bölgesi 3. Koridor Seviye 1', 'B', '3', 1, 100),

-- C Bölgesi rafları (devamı)
('C1-03', 'C Bölgesi 1. Koridor Seviye 3', 'C', '1', 3, 100),
('C2-01', 'C Bölgesi 2. Koridor Seviye 1', 'C', '2', 1, 100),
('C2-02', 'C Bölgesi 2. Koridor Seviye 2', 'C', '2', 2, 100),
('C2-03', 'C Bölgesi 2. Koridor Seviye 3', 'C', '2', 3, 100),

-- D Bölgesi (yeni)
('D1-01', 'D Bölgesi 1. Koridor Seviye 1', 'D', '1', 1, 150),
('D1-02', 'D Bölgesi 1. Koridor Seviye 2', 'D', '1', 2, 150),
('D1-03', 'D Bölgesi 1. Koridor Seviye 3', 'D', '1', 3, 150),

-- Özel raflar
('PICK-01', 'Toplama Alanı Raf 1', 'PICK', '1', 1, 50),
('PICK-02', 'Toplama Alanı Raf 2', 'PICK', '1', 2, 50),
('RETURN-01', 'İade Alanı Raf 1', 'RETURN', '1', 1, 75),
('QUARANTINE-01', 'Karantina Alanı Raf 1', 'QUARANTINE', '1', 1, 25);

-- İstatistik görüntüle
SELECT 
    COUNT(*) as toplam_raf,
    COUNT(DISTINCT zone) as toplam_bolge,
    COUNT(DISTINCT zone || '-' || aisle) as toplam_koridor
FROM shelves;

-- Bölge bazında raf sayıları
SELECT zone, COUNT(*) as raf_sayisi 
FROM shelves 
GROUP BY zone 
ORDER BY zone;