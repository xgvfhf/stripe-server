const QRCode = require('qrcode');

const generateQRCode = async (data) => {
  try {
    const jsonData = JSON.stringify(data);
    const outputPath = `qr_codes_img/station_${data.stationId}.png`;

    await QRCode.toFile(outputPath, jsonData, {
      width: 300,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF"
      }
    });

    console.log(`QR-код для станции ${data.stationId} сохранен как ${outputPath}`);
  } catch (err) {
    console.error('Ошибка при создании QR-кода:', err);
  }
};

// Пример данных для станции
generateQRCode({ stationId: 1, country: "Lithuania", city: "Vilnius", street: "Saulėtekio al. 15" });
generateQRCode({ stationId: 2, country: "Lithuania", city: "Vilnius", street: "Antakalnio g. 86" });
generateQRCode({ stationId: 3, country: "Lithuania", city: "Vilnius", street: "Antakalnio g. 41" });