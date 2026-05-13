/**
 * Auth Context
 *
 * Provides reactive authentication state to the app.
 * Wraps the account service and listens for auth state changes.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';
import type { IAccountService, UserProfile } from '../services/account-service';

interface AuthContextValue {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, profile: { firstName: string; lastName: string }) => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordResetEmail: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  accountService: IAccountService;
  onUserChanged?: (user: UserProfile | null) => void;
  children: ReactNode;
}

export function AuthProvider({ accountService, onUserChanged, children }: AuthProviderProps) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = accountService.onAuthStateChanged((firebaseUser) => {
      setUser(firebaseUser);
      setIsLoading(false);
      onUserChanged?.(firebaseUser);
    });

    return unsubscribe;
  }, [accountService, onUserChanged]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    await accountService.signInWithEmail(email, password);
  }, [accountService]);

  const signUpWithEmail = useCallback(async (
    email: string,
    password: string,
    profile: { firstName: string; lastName: string }
  ) => {
    await accountService.signUpWithEmail(email, password, profile);
  }, [accountService]);

  const signInWithApple = useCallback(async () => {
    await accountService.signInWithApple();
  }, [accountService]);

  const signInWithGoogle = useCallback(async () => {
    await accountService.signInWithGoogle();
  }, [accountService]);

  const signOut = useCallback(async () => {
    await accountService.signOut();
  }, [accountService]);

  const sendPasswordResetEmail = useCallback(async (email: string) => {
    await accountService.sendPasswordResetEmail(email);
  }, [accountService]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isAuthenticated: user !== null,
    isLoading,
    signInWithEmail,
    signUpWithEmail,
    signInWithApple,
    signInWithGoogle,
    signOut,
    sendPasswordResetEmail,
  }), [user, isLoading, signInWithEmail, signUpWithEmail, signInWithApple, signInWithGoogle, signOut, sendPasswordResetEmail]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
