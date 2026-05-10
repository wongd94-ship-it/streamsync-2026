/**
 * Unit Tests for Consent Service
 *
 * The ConsentService manages informed consent for the research study.
 * It tracks whether participants have consented, which version they
 * consented to, and when. This is critical for IRB compliance.
 *
 * Key behaviors tested:
 * - Consent status checking (hasConsented)
 * - Consent version management (isConsentCurrent, needsReconsent)
 * - Recording new consent with optional signature
 * - Consent withdrawal for participant exit
 * - Persistence across app sessions
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS, CONSENT_VERSION, STUDY_INFO } from '../../constants';

/**
 * Helper to create a fresh ConsentService instance for each test.
 * Resets the module cache to clear the singleton state.
 */
const createConsentService = () => {
  jest.resetModules();
  const { ConsentService } = require('../consent-service');
  return ConsentService;
};

describe('ConsentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: simulate empty storage (no prior consent)
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  /**
   * Tests for hasConsented()
   *
   * Checks if the participant has given informed consent.
   * Returns true only if consent was explicitly recorded.
   */
  describe('hasConsented', () => {
    /**
     * Verifies that a new user (no stored consent) is correctly
     * identified as not having consented.
     */
    it('should return false when no consent record exists', async () => {
      const service = createConsentService();
      const result = await service.hasConsented();
      expect(result).toBe(false);
    });

    /**
     * Verifies that when valid consent data exists in storage
     * (given=true, date present, version present), the service
     * correctly reports consent as given.
     */
    it('should return true when valid consent exists in storage', async () => {
      // Simulate storage with all three required consent keys
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === STORAGE_KEYS.CONSENT_GIVEN) return Promise.resolve('true');
        if (key === STORAGE_KEYS.CONSENT_DATE) return Promise.resolve('2024-01-01T00:00:00.000Z');
        if (key === STORAGE_KEYS.CONSENT_VERSION) return Promise.resolve(CONSENT_VERSION);
        return Promise.resolve(null);
      });

      const service = createConsentService();
      const result = await service.hasConsented();
      expect(result).toBe(true);
    });

    /**
     * Verifies that incomplete consent data (e.g., only CONSENT_GIVEN
     * without the other required fields) does not count as valid consent.
     */
    it('should return false when consent data is incomplete (missing date/version)', async () => {
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        // Only CONSENT_GIVEN is set, missing date and version
        if (key === STORAGE_KEYS.CONSENT_GIVEN) return Promise.resolve('true');
        return Promise.resolve(null);
      });

      const service = createConsentService();
      const result = await service.hasConsented();
      expect(result).toBe(false);
    });
  });

  /**
   * Tests for isConsentCurrent()
   *
   * Checks if the participant's consent matches the current consent
   * document version. If the consent form has been updated (new version),
   * participants may need to re-consent.
   */
  describe('isConsentCurrent', () => {
    /**
     * Verifies that without any consent, isConsentCurrent returns false.
     */
    it('should return false when no consent exists', async () => {
      const service = createConsentService();
      const result = await service.isConsentCurrent();
      expect(result).toBe(false);
    });

    /**
     * Verifies that consent matching the current CONSENT_VERSION
     * is considered current (no re-consent needed).
     */
    it('should return true when consented version matches current version', async () => {
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === STORAGE_KEYS.CONSENT_GIVEN) return Promise.resolve('true');
        if (key === STORAGE_KEYS.CONSENT_DATE) return Promise.resolve('2024-01-01T00:00:00.000Z');
        if (key === STORAGE_KEYS.CONSENT_VERSION) return Promise.resolve(CONSENT_VERSION);
        return Promise.resolve(null);
      });

      const service = createConsentService();
      const result = await service.isConsentCurrent();
      expect(result).toBe(true);
    });

    /**
     * Verifies that consent from an older version is identified as
     * not current, allowing the app to prompt for re-consent.
     */
    it('should return false when consented version differs from current', async () => {
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === STORAGE_KEYS.CONSENT_GIVEN) return Promise.resolve('true');
        if (key === STORAGE_KEYS.CONSENT_DATE) return Promise.resolve('2024-01-01T00:00:00.000Z');
        // Simulate an old consent version
        if (key === STORAGE_KEYS.CONSENT_VERSION) return Promise.resolve('0.9.0');
        return Promise.resolve(null);
      });

      const service = createConsentService();
      const result = await service.isConsentCurrent();
      expect(result).toBe(false);
    });
  });

  /**
   * Tests for recordConsent()
   *
   * Records that the participant has given informed consent.
   * Stores the consent status, timestamp, and current version.
   * Optionally accepts a signature (typed name).
   */
  describe('recordConsent', () => {
    /**
     * Verifies that recording consent persists all three required
     * keys to AsyncStorage: given flag, date, and version.
     */
    it('should store all consent data to AsyncStorage', async () => {
      const service = createConsentService();
      await service.recordConsent();

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEYS.CONSENT_GIVEN, 'true');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        STORAGE_KEYS.CONSENT_DATE,
        expect.any(String)
      );
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        STORAGE_KEYS.CONSENT_VERSION,
        CONSENT_VERSION
      );
    });

    /**
     * Verifies that a signature can be provided and is stored
     * in the consent record for IRB documentation purposes.
     */
    it('should store participant signature when provided', async () => {
      const service = createConsentService();
      await service.recordConsent('John Doe');

      const record = await service.getConsentRecord();
      expect(record?.participantSignature).toBe('John Doe');
    });

    /**
     * Verifies that after recording consent, hasConsented() returns true.
     */
    it('should report as consented immediately after recording', async () => {
      const service = createConsentService();
      await service.recordConsent();

      const hasConsented = await service.hasConsented();
      expect(hasConsented).toBe(true);
    });
  });

  /**
   * Tests for withdrawConsent()
   *
   * Removes all consent records. Used when a participant chooses
   * to withdraw from the study per IRB requirements.
   */
  describe('withdrawConsent', () => {
    /**
     * Verifies that withdrawal removes all three consent keys
     * from AsyncStorage in a single atomic operation.
     */
    it('should remove all consent keys from storage using multiRemove', async () => {
      const service = createConsentService();
      await service.recordConsent();
      await service.withdrawConsent();

      expect(AsyncStorage.multiRemove).toHaveBeenCalledWith([
        STORAGE_KEYS.CONSENT_GIVEN,
        STORAGE_KEYS.CONSENT_DATE,
        STORAGE_KEYS.CONSENT_VERSION,
        STORAGE_KEYS.CONSENT_SIGNATURE,
      ]);
    });

    /**
     * Verifies that after withdrawal, hasConsented() returns false.
     */
    it('should report as not consented after withdrawal', async () => {
      const service = createConsentService();
      await service.recordConsent();
      await service.withdrawConsent();

      const hasConsented = await service.hasConsented();
      expect(hasConsented).toBe(false);
    });
  });

  /**
   * Tests for getConsentRecord()
   *
   * Returns the full consent record object containing all details
   * about when and how consent was given.
   */
  describe('getConsentRecord', () => {
    /**
     * Verifies null is returned when no consent has been recorded.
     */
    it('should return null when no consent exists', async () => {
      const service = createConsentService();
      const record = await service.getConsentRecord();
      expect(record).toBeNull();
    });

    /**
     * Verifies that the consent record includes study metadata
     * (study name, IRB protocol) from the constants.
     */
    it('should return consent record with study info when consent exists', async () => {
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === STORAGE_KEYS.CONSENT_GIVEN) return Promise.resolve('true');
        if (key === STORAGE_KEYS.CONSENT_DATE) return Promise.resolve('2024-01-01T00:00:00.000Z');
        if (key === STORAGE_KEYS.CONSENT_VERSION) return Promise.resolve(CONSENT_VERSION);
        return Promise.resolve(null);
      });

      const service = createConsentService();
      const record = await service.getConsentRecord();

      expect(record).toEqual({
        given: true,
        version: CONSENT_VERSION,
        timestamp: '2024-01-01T00:00:00.000Z',
        studyName: STUDY_INFO.name,
        irbProtocol: STUDY_INFO.irbProtocol,
      });
    });
  });

  /**
   * Tests for getCurrentVersion()
   *
   * Returns the current consent document version constant.
   * Synchronous method - doesn't require storage access.
   */
  describe('getCurrentVersion', () => {
    /**
     * Verifies the method returns the CONSENT_VERSION constant.
     */
    it('should return the current consent version constant', () => {
      const service = createConsentService();
      expect(service.getCurrentVersion()).toBe(CONSENT_VERSION);
    });
  });

  /**
   * Tests for needsReconsent()
   *
   * Determines if a participant who previously consented needs to
   * re-consent due to an updated consent document.
   */
  describe('needsReconsent', () => {
    /**
     * Verifies that without prior consent, re-consent is not needed
     * (they need initial consent instead).
     */
    it('should return false when no consent exists', async () => {
      const service = createConsentService();
      const result = await service.needsReconsent();
      expect(result).toBe(false);
    });

    /**
     * Verifies that current consent does not trigger re-consent.
     */
    it('should return false when consent version is current', async () => {
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === STORAGE_KEYS.CONSENT_GIVEN) return Promise.resolve('true');
        if (key === STORAGE_KEYS.CONSENT_DATE) return Promise.resolve('2024-01-01T00:00:00.000Z');
        if (key === STORAGE_KEYS.CONSENT_VERSION) return Promise.resolve(CONSENT_VERSION);
        return Promise.resolve(null);
      });

      const service = createConsentService();
      const result = await service.needsReconsent();
      expect(result).toBe(false);
    });

    /**
     * Verifies that outdated consent version triggers re-consent requirement.
     */
    it('should return true when consent version is outdated', async () => {
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === STORAGE_KEYS.CONSENT_GIVEN) return Promise.resolve('true');
        if (key === STORAGE_KEYS.CONSENT_DATE) return Promise.resolve('2024-01-01T00:00:00.000Z');
        // Old version that doesn't match current CONSENT_VERSION
        if (key === STORAGE_KEYS.CONSENT_VERSION) return Promise.resolve('0.9.0');
        return Promise.resolve(null);
      });

      const service = createConsentService();
      const result = await service.needsReconsent();
      expect(result).toBe(true);
    });
  });

  /**
   * Tests for error handling
   *
   * Verifies graceful handling of AsyncStorage failures.
   */
  describe('error handling', () => {
    /**
     * Verifies that storage errors during initialization don't crash
     * the service - it defaults to "no consent" state.
     */
    it('should handle storage errors gracefully during initialization', async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('Storage error'));

      const service = createConsentService();
      const result = await service.hasConsented();

      // Should complete without throwing, defaulting to no consent
      expect(result).toBe(false);
    });
  });
});
