const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

class ForgeInstaller {
  constructor(minecraftPath, statusCallback) {
    this.minecraftPath = minecraftPath;
    this.statusCallback = statusCallback || function() {};
    this.tempDir = path.join(app.getPath('temp'), 'minecraft-mod-installer');
    
    // Forge sürümü ve indirme URL'si 
    this.forgeVersion = '1.20.1-47.4.0'; // Minecraft 1.20.1 için Forge sürümü
    this.forgeInstallerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${this.forgeVersion}/forge-${this.forgeVersion}-installer.jar`;
    this.forgeInstallerPath = path.join(this.tempDir, `forge-${this.forgeVersion}-installer.jar`);
  }

  async installForge() {
    try {
      // Geçici klasörü oluştur
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true });
      }

      // Forge installer'ı indir
      this.statusCallback('Forge installer indiriliyor...');
      await this.downloadForgeInstaller();

      // Forge'u kur
      this.statusCallback('Forge kuruluyor...');
      const installResult = await this.runForgeInstaller();

      return installResult;
    } catch (error) {
      console.error('Forge kurulum hatası:', error);
      return { success: false, message: error.message };
    }
  }

  async downloadForgeInstaller() {
    try {
      const response = await axios({
        method: 'GET',
        url: this.forgeInstallerUrl,
        responseType: 'arraybuffer'
      });

      fs.writeFileSync(this.forgeInstallerPath, Buffer.from(response.data));
      return true;
    } catch (error) {
      console.error('Forge indirme hatası:', error);
      throw new Error(`Forge indirme hatası: ${error.message}`);
    }
  }

  async runForgeInstaller() {
    return new Promise((resolve, reject) => {
      // Java'nın yüklü olup olmadığını kontrol et
      this.checkJavaInstallation()
        .then(javaPath => {
          // Forge installer'ı çalıştır
          // Try with different arguments format
          const args = [
            '-jar',
            this.forgeInstallerPath,
            'installClient',  // Remove the -- prefix
            this.minecraftPath  // Pass the path directly without a parameter name
          ];

          const installer = spawn(javaPath, args, { cwd: this.tempDir });

          installer.stdout.on('data', (data) => {
            const message = data.toString().trim();
            if (message) this.statusCallback(`Forge: ${message}`);
          });

          installer.stderr.on('data', (data) => {
            const message = data.toString().trim();
            if (message) this.statusCallback(`Forge Hata: ${message}`);
          });

          installer.on('close', (code) => {
            if (code === 0) {
              resolve({ success: true, message: 'Forge başarıyla kuruldu!' });
            } else {
              reject(new Error(`Forge kurulumu başarısız oldu (Çıkış kodu: ${code})`));
            }
          });

          installer.on('error', (err) => {
            reject(new Error(`Forge kurulum hatası: ${err.message}`));
          });
        })
        .catch(error => {
          reject(error);
        });
    });
  }

  async checkJavaInstallation() {
    return new Promise((resolve, reject) => {
      // Windows'ta Java'nın yüklü olup olmadığını kontrol et
      const javaCheck = spawn('where', ['java'], { shell: true });
      
      let javaPath = '';
      let errorOutput = '';
      
      javaCheck.stdout.on('data', (data) => {
        javaPath = data.toString().trim().split('\n')[0];
      });

      javaCheck.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      javaCheck.on('close', (code) => {
        if (code === 0 && javaPath) {
          // Java bulundu, yolu doğrula
          this.statusCallback(`Java bulundu: ${javaPath}`);
          resolve(javaPath);
        } else {
          // Alternatif yolları kontrol et
          const commonJavaPaths = [
            // Existing paths
            'C:\\Program Files\\Java\\jre-1.8\\bin\\java.exe',
            'C:\\Program Files\\Java\\jre1.8.0_301\\bin\\java.exe',
            'C:\\Program Files\\Java\\jre1.8.0_333\\bin\\java.exe',
            'C:\\Program Files\\Java\\jre-1.8.0\\bin\\java.exe',
            'C:\\Program Files (x86)\\Java\\jre1.8.0_301\\bin\\java.exe',
            'C:\\Program Files (x86)\\Java\\jre1.8.0_333\\bin\\java.exe',
            'C:\\Program Files\\Common Files\\Oracle\\Java\\javapath\\java.exe',
            'C:\\ProgramData\\Oracle\\Java\\javapath\\java.exe',
            // Additional paths to check
            'C:\\Program Files (x86)\\Common Files\\Oracle\\Java\\java8path\\java.exe',
            'C:\\Program Files (x86)\\Common Files\\Oracle\\Java\\javapath\\java.exe',
            'C:\\Windows\\System32\\java.exe',
            'C:\\Windows\\SysWOW64\\java.exe',
            // Check for newer Java versions
            'C:\\Program Files\\Java\\jre-1.8.0_431\\bin\\java.exe',
            'C:\\Program Files\\Java\\jdk-1.8.0_431\\bin\\java.exe',
            'C:\\Program Files\\Java\\jdk-11\\bin\\java.exe',
            'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe',
            'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe',
            'C:\\Program Files (x86)\\Java\\jre-1.8.0_431\\bin\\java.exe',
            'C:\\Program Files (x86)\\Java\\jdk-1.8.0_431\\bin\\java.exe'
          ];
          
          // Try to find Java in Program Files by scanning directories
          try {
            const javaRootDirs = [
              'C:\\Program Files\\Java',
              'C:\\Program Files (x86)\\Java'
            ];
            
            for (const rootDir of javaRootDirs) {
              if (fs.existsSync(rootDir)) {
                const javaDirs = fs.readdirSync(rootDir);
                for (const javaDir of javaDirs) {
                  const possibleJavaPath = path.join(rootDir, javaDir, 'bin', 'java.exe');
                  if (fs.existsSync(possibleJavaPath)) {
                    this.statusCallback(`Java dinamik olarak bulundu: ${possibleJavaPath}`);
                    return resolve(possibleJavaPath);
                  }
                }
              }
            }
          } catch (err) {
            this.statusCallback(`Java dizinlerini tararken hata: ${err.message}`);
          }
          
          for (const jPath of commonJavaPaths) {
            if (fs.existsSync(jPath)) {
              this.statusCallback(`Java alternatif konumda bulundu: ${jPath}`);
              return resolve(jPath);
            }
          }
          
          // Java bulunamadı, kullanıcıya bilgi ver
          this.statusCallback('Java bulunamadı. Java kurulumu gerekiyor.');
          reject(new Error('Java bulunamadı. Lütfen Java yükleyin ve tekrar deneyin. (https://www.java.com/download/)'));
        }
      });

      javaCheck.on('error', (err) => {
        this.statusCallback(`Java kontrol hatası: ${err.message}`);
        reject(new Error(`Java kontrol hatası: ${err.message}`));
      });
    });
  }
}

module.exports = ForgeInstaller;