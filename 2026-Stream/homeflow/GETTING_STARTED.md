# Getting Started with StreamSync

This guide will help you set up and run your app.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file and add your keys
cp .env.example .env

# Start the iPhone simulator with Metro attached
npm run ios:sim
```

## Environment Setup

Copy `.env.example` to `.env` and fill in the required values:

### Local Storage

Your app uses local AsyncStorage for data persistence.
No cloud configuration is required.

> **Note:** Data is stored on-device only. Users cannot sync
> across devices, and data is lost when the app is uninstalled.

### AI Chat Configuration

Your app includes the Chat feature with AI integration.

> **⚠️ Security Warning:** API keys are exposed client-side in
> React Native apps. For production, implement a backend proxy
> to keep your keys secure.

Get API keys for your selected providers:

- **OpenAI**: [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)

Add the keys to your `.env` file:

```
EXPO_PUBLIC_OPENAI_API_KEY=your-api-key
```

### iOS Prerequisites

Before opening the iOS app for the first time, make sure the machine has:

- Node.js available in a normal shell
- Xcode and an installed iOS simulator runtime
- CocoaPods available for the local Ruby setup

The app uses a native Expo development build, not Expo Go.

### HealthKit Setup (iOS Only)

Your app includes Apple HealthKit integration for health data access.

> **⚠️ Important:** HealthKit requires a custom development build.
> It will NOT work in Expo Go.

#### Building for iOS:

```bash
# Simulator development build
npm run ios:sim

# Physical iPhone development build
npm run ios:device

# Start Metro for an already-installed development build
npm run ios:metro
```

Important:

- `Debug` builds expect Metro to be running when the app opens.
- If you launch the app directly from Simulator or Xcode without Metro, you can get `No script URL provided`.
- `Release` builds embed the JS bundle and can launch without Metro.

#### Testing:

- Use a **physical iOS device** for best results
- Simulator has limited HealthKit support
- Add test data: Simulator → Features → Health → Health Data

#### Configuration:

Edit `lib/healthkit-config.ts` to customize which health metrics to collect.

## Your App Features

Based on your selections, your app includes:

- **Local Storage** - On-device data persistence
- **Chat** - AI-powered chat interface with LLM integration
- **Scheduler** - Recurring tasks and reminder management
- **Questionnaires** - FHIR-compliant health forms
- **HealthKit** - Apple Health data integration (iOS only)

## Running on Devices

```bash
# iOS Simulator
npm run ios:sim

# iPhone
npm run ios:device

# Android Emulator
npm run android

# Web Browser
npm run web
```

## Project Structure

```
├── app/              # Expo Router screens
│   ├── (tabs)/       # Bottom tab screens
│   └── questionnaire/# Health form screens
├── packages/         # Shared modules
│   └── chat/         # AI chat functionality
│   └── scheduler/    # Task scheduling
│   └── questionnaire/# FHIR forms
│   └── healthkit/    # Apple Health integration
├── lib/              # App utilities
└── components/       # Reusable UI components
```

## Learn More

- [Expo Documentation](https://docs.expo.dev)
- [Expo Router](https://expo.github.io/router/docs)
- [React Native](https://reactnative.dev)
