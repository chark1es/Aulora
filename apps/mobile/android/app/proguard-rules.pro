# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# react-native-webrtc: libjingle_peerconnection_so resolves org.webrtc and
# org.jni_zero classes by name from native JNI_OnLoad (org.jni_zero.JniZero has
# no Java referrers), so R8 must not strip or rename them. Without this the
# release app aborts at launch ("JNI DETECTED ERROR: java_class == null").
-keep class org.webrtc.** { *; }
-keep class org.jni_zero.** { *; }
-dontwarn org.jni_zero.**
-keep class com.oney.WebRTCModule.** { *; }

# react-native-webrtc: R8 cannot resolve this JNI-only class (it is absent on
# some ABIs), so treat the reference as an external symbol instead of failing.
-dontwarn org.webrtc.Dav1dDecoder$Natives

# Add any project specific keep options here:
