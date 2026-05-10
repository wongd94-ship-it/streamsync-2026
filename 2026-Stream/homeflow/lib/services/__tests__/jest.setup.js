/**
 * Jest Setup for Service Tests
 *
 * This file runs before each test file and sets up global mocks.
 */

// Create mock functions that can be reset
const mockAsyncStorage = {
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  multiRemove: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
  getAllKeys: jest.fn(() => Promise.resolve([])),
};

// Mock AsyncStorage - this mock persists across jest.resetModules()
jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

// Mock Firebase
jest.mock('firebase/app', () => ({
  initializeApp: jest.fn(),
  getApps: jest.fn(() => []),
  getApp: jest.fn(),
}));

jest.mock('firebase/firestore', () => ({
  getFirestore: jest.fn(() => ({})),
  collection: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  setDoc: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  onSnapshot: jest.fn(),
  serverTimestamp: jest.fn(),
}));

jest.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  onAuthStateChanged: jest.fn(() => jest.fn()),
  updateProfile: jest.fn(),
  OAuthProvider: jest.fn(),
  signInWithCredential: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  GoogleAuthProvider: { credential: jest.fn() },
  initializeAuth: jest.fn(() => ({ currentUser: null })),
  getReactNativePersistence: jest.fn(),
}));

jest.mock('firebase/auth/react-native', () => ({
  initializeAuth: jest.fn(() => ({ currentUser: null })),
  getReactNativePersistence: jest.fn(),
}), { virtual: true });

// Mock expo native modules
jest.mock('expo-apple-authentication', () => ({
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  AppleAuthenticationButtonType: { SIGN_IN: 0, SIGN_UP: 1 },
  AppleAuthenticationButtonStyle: { BLACK: 0, WHITE: 1 },
  AppleAuthenticationButton: 'AppleAuthenticationButton',
}));

jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn(() => Promise.resolve('hashed')),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(),
    signIn: jest.fn(),
  },
}));

// Reset mocks before each test
beforeEach(() => {
  mockAsyncStorage.setItem.mockClear();
  mockAsyncStorage.setItem.mockImplementation(() => Promise.resolve());
  mockAsyncStorage.getItem.mockClear();
  mockAsyncStorage.getItem.mockImplementation(() => Promise.resolve(null));
  mockAsyncStorage.removeItem.mockClear();
  mockAsyncStorage.removeItem.mockImplementation(() => Promise.resolve());
  mockAsyncStorage.multiRemove.mockClear();
  mockAsyncStorage.multiRemove.mockImplementation(() => Promise.resolve());
  mockAsyncStorage.clear.mockClear();
  mockAsyncStorage.getAllKeys.mockClear();
});

// Silence console warnings in tests
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
};
