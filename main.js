const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const AdmZip = require('adm-zip');
const Store = require('electron-store');
const ForgeInstaller = require('./forge-installer');

// Ayarları saklamak için store oluştur
const store = new Store();

// Pencere referansını global olarak tut
let mainWindow;

// Uygulama hazır olduğunda çalışacak fonksiyon
app.whenReady().then(() => {
  createWindow();

  // macOS için pencere yeniden açma işlemi
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Tüm pencereler kapandığında uygulamayı kapat (Windows & Linux)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Ana pencereyi oluştur
function createWindow() {
  // Set initial size based on screen size
  const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = Math.min(800, width * 0.8);
  const windowHeight = Math.min(600, height * 0.8);

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 500,
    minHeight: 400,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'assets/icon.ico'),
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    backgroundColor: '#36393f'
  });

  // HTML dosyasını yükle
  mainWindow.loadFile('index.html');

  // Geliştirici araçlarını kapat
  // mainWindow.webContents.openDevTools();
}

// .minecraft klasörünü seçme işlemi
ipcMain.handle('select-minecraft-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Minecraft Klasörünü Seçin (.minecraft)'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const minecraftPath = result.filePaths[0];
    // Seçilen yolu kaydet
    store.set('minecraftPath', minecraftPath);
    return minecraftPath;
  }
  return null;
});

// Kaydedilmiş Minecraft yolunu al
ipcMain.handle('get-minecraft-path', () => {
  return store.get('minecraftPath', '');
});

// Mod paketini indir ve kur
ipcMain.handle('install-mods', async (event, minecraftPath) => {
  try {
    // Mod klasörünü oluştur (yoksa)
    const modsDir = path.join(minecraftPath, 'mods');
    if (!fs.existsSync(modsDir)) {
      fs.mkdirSync(modsDir, { recursive: true });
    }

    // Shader klasörünü oluştur (yoksa)
    const shadersDir = path.join(minecraftPath, 'shaderpacks');
    if (!fs.existsSync(shadersDir)) {
      fs.mkdirSync(shadersDir, { recursive: true });
    }

    // Resource pack klasörünü oluştur (yoksa)
    const resourcePacksDir = path.join(minecraftPath, 'resourcepacks');
    if (!fs.existsSync(resourcePacksDir)) {
      fs.mkdirSync(resourcePacksDir, { recursive: true });
    }

    // Forge kurulumu için klasör oluştur
    const forgeDir = path.join(app.getPath('temp'), 'minecraft-mod-installer');
    if (!fs.existsSync(forgeDir)) {
      fs.mkdirSync(forgeDir, { recursive: true });
    }

    // Forge kurulumunu başlat
    mainWindow.webContents.send('update-status', 'Forge kurulumu başlatılıyor...');
    const forgeInstaller = new ForgeInstaller(minecraftPath, (status) => {
      // Filter out detailed Forge messages
      if (!status.startsWith('Forge:') && !status.startsWith('Forge Hata:')) {
        mainWindow.webContents.send('update-status', status);
      }
    });
    
    const forgeResult = await forgeInstaller.installForge();
    if (!forgeResult.success) {
      mainWindow.webContents.send('update-status', `Forge kurulum hatası: ${forgeResult.message}`);
      return forgeResult;
    }
    
    mainWindow.webContents.send('update-status', 'Forge başarıyla kuruldu!');

    // İndirme işlemleri
    mainWindow.webContents.send('update-status', 'Mod paketi indiriliyor...');
    await downloadAndExtract(
      'https://drive.usercontent.google.com/download?id=1_YTH-15ewNYLqQN6IZuV4ARZFFjQwuY8&export=download&authuser=0&confirm=t&uuid=a9e35062-8f78-4b18-b945-3fdbe2a8a9e2&at=APcmpoxXdfjE-QIZlsvSZBzp0bai%3A1743697180972',
      modsDir,
      'mods.zip'
    );

    mainWindow.webContents.send('update-status', 'Shader paketi indiriliyor...');
    await downloadAndExtract(
      'https://drive.usercontent.google.com/download?id=1S_OJU0vJHjmhakaV78d7XBfoXlqrsN3m&export=download&authuser=0',
      shadersDir,
      'shader.zip'
    );

    mainWindow.webContents.send('update-status', 'Resource paketi indiriliyor...');
    await downloadAndExtract(
      'https://drive.usercontent.google.com/download?id=1Dm9RqbkpW4D8HVN-wMUMygKigeFpGSxZ&export=download&confirm=t&uuid=116853f0-4acc-4b5a-8510-473ea6917aac',
      resourcePacksDir,
      'resourcepack.zip'
    );

    mainWindow.webContents.send('update-status', 'Kurulum tamamlandı!');
    return { success: true, message: 'Forge ve tüm paketler başarıyla kuruldu!' };
  } catch (error) {
    console.error('Kurulum hatası:', error);
    mainWindow.webContents.send('update-status', 'Kurulum sırasında hata oluştu!');
    return { success: false, message: `Hata: ${error.message}` };
  }
});

// Dosya indirme ve çıkarma fonksiyonu
async function downloadAndExtract(url, targetDir, filename) {
  try {
    // Geçici dosya yolu
    const tempFilePath = path.join(app.getPath('temp'), filename);

    // Dosyayı indir
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      onDownloadProgress: (progressEvent) => {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        mainWindow.webContents.send('download-progress', percentCompleted);
      }
    });

    // Dosyayı geçici konuma kaydet
    fs.writeFileSync(tempFilePath, Buffer.from(response.data));

    // ZIP dosyasını çıkar
    const zip = new AdmZip(tempFilePath);
    zip.extractAllTo(targetDir, true);

    // Geçici dosyayı sil
    fs.unlinkSync(tempFilePath);

    return true;
  } catch (error) {
    console.error(`Dosya indirme/çıkarma hatası (${filename}):`, error);
    throw error;
  }
}

// Window control handlers
ipcMain.on('close-window', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('maximize-window', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});