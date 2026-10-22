import java.io.File

plugins {
    id("com.android.application")
}

// 正式签名：CI 环境通过环境变量注入 keystore（GitHub Secrets）
val ksFile: File? = System.getenv("KEYSTORE_PATH")
    ?.takeIf { it.isNotBlank() }
    ?.let { File(it) }
    ?.takeIf { it.exists() }

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

    val kf = ksFile
    if (kf != null) {
        signingConfigs {
            create("release") {
                storeFile = kf
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (kf != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
