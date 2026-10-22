plugins {
    id("com.android.application")
}

android {
    namespace = "site.sc27c.zhican"
    compileSdk = 34

    defaultConfig {
        applicationId = "site.sc27c.zhican"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
