import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase, updateUsername as dbUpdateUsername, updateAvatarUrl as dbUpdateAvatarUrl } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';

export interface Profile {
  id: string;
  email: string;
  username: string | null;
  username_changed_at: string | null;
  verified: boolean;
  avatar_url: string | null;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  updateUsername: (username: string) => Promise<string | null>;
  updateAvatarUrl: (url: string | null) => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(uid: string, email: string) {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, username, username_changed_at, verified, avatar_url')
      .eq('id', uid)
      .maybeSingle();

    if (data) {
      setProfile(data as Profile);
      return;
    }

    // Profile trigger may not have run yet (or old account). Create on demand.
    const { data: inserted, error } = await supabase
      .from('profiles')
      .upsert({ id: uid, email, username: email.split('@')[0] ?? 'user' })
      .select('id, email, username, username_changed_at, verified, avatar_url')
      .single();

    if (!error && inserted) {
      setProfile(inserted as Profile);
    } else {
      setProfile({
        id: uid,
        email,
        username: email.split('@')[0] ?? 'user',
        username_changed_at: null,
        verified: false,
        avatar_url: null,
      });
    }
  }

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      const session = data.session;
      setUser(session?.user ?? null);
      if (session?.user) {
        await loadProfile(session.user.id, session.user.email ?? '');
      }
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      if (session?.user) {
        await loadProfile(session.user.id, session.user.email ?? '');
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error?.message ?? null;
  };

  const signUp = async (
    email: string,
    password: string
  ): Promise<{ error: string | null; needsConfirmation: boolean }> => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message, needsConfirmation: false };
    // If no session is returned, email confirmation is enabled for the project.
    const needsConfirmation = !data.session;
    if (!needsConfirmation && data.user) {
      await loadProfile(data.user.id, data.user.email ?? email);
    }
    return { error: null, needsConfirmation };
  };

  const signOut = async (): Promise<void> => {
    await supabase.auth.signOut();
  };

  const updateUsername = async (username: string): Promise<string | null> => {
    if (!user) return 'Not signed in.';
    const error = await dbUpdateUsername(user.id, username);
    if (error) return error;
    await loadProfile(user.id, user.email ?? '');
    return null;
  };

  const updateAvatarUrl = async (url: string | null): Promise<string | null> => {
    if (!user) return 'Not signed in.';
    const error = await dbUpdateAvatarUrl(user.id, url);
    if (error) return error;
    await loadProfile(user.id, user.email ?? '');
    return null;
  };

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, signIn, signUp, signOut, updateUsername, updateAvatarUrl }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
