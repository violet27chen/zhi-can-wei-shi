import java.io.File

plugins {
    id("com.android.application")
}

// 正式签名：CI 环境通过环境变量注入 keystore（GitHub Secrets）
val ksPath: String? = System.getenv("KEYSTORE_PATH")
val hasKeystore: Boolean = !ksPath.isNullOrBlank() && File(ksPath).exists()

android {
    namespace = "site.sc27c.zhican"
    compileSdk = 34

    defaultConfig {
        applicationId = "site.sc27c.zhican"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "1.0.1"
    }

    if (hasKeystore) {
        signingConfigs {
            create("release") {
                storeFile = file(ksPath)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (hasKeystore) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
