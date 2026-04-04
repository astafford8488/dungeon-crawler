// supabase.js — Supabase client, auth, cloud saves, leaderboard
const Cloud = (() => {
  const SUPABASE_URL = 'https://enjkfhchfgpksthnvuew.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuamtmaGNoZmdwa3N0aG52dWV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMjEyNjksImV4cCI6MjA5MDc5NzI2OX0.h5w-dSs3BoF0fFCEO-uAXcZTJrnMMs5loem3wmDkAFM';

  let supabase = null;
  let currentUser = null;

  function init() {
    if (window.supabase) {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'dungeon-crawler-auth',
        }
      });
      // Listen for auth state changes
      supabase.auth.onAuthStateChange((event, session) => {
        currentUser = session?.user || null;
        updateAuthUI();
      });
      // Check existing session
      supabase.auth.getSession().then(({ data: { session } }) => {
        currentUser = session?.user || null;
        updateAuthUI();
      });
    }
  }

  function updateAuthUI() {
    const authBtn = document.getElementById('btn-auth');
    const authStatus = document.getElementById('auth-status');
    if (!authBtn) return;
    if (currentUser) {
      authBtn.textContent = 'Logout';
      if (authStatus) authStatus.textContent = currentUser.email;
    } else {
      authBtn.textContent = 'Login';
      if (authStatus) authStatus.textContent = '';
    }
  }

  // Auth functions
  async function signUp(email, password, displayName) {
    if (!supabase) return { error: 'Supabase not loaded' };
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName || 'Adventurer' } }
    });
    if (!error) currentUser = data.user;
    return { data, error };
  }

  async function signIn(email, password) {
    if (!supabase) return { error: 'Supabase not loaded' };
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) currentUser = data.user;
    return { data, error };
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    currentUser = null;
    updateAuthUI();
  }

  // Cloud save functions
  async function cloudSave(slot, gameState) {
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    // Ensure profile exists
    await supabase.from('profiles').upsert({
      id: currentUser.id,
      display_name: currentUser.user_metadata?.display_name || currentUser.email?.split('@')[0] || 'Adventurer',
    }, { onConflict: 'id', ignoreDuplicates: true });

    const avgLevel = gameState.party?.length > 0
      ? Math.round(gameState.party.reduce((s, m) => s + m.level, 0) / gameState.party.length)
      : 0;
    const { data, error } = await supabase.from('save_games').upsert({
      user_id: currentUser.id,
      slot,
      party_name: gameState.partyName || 'Unnamed Party',
      avg_level: avgLevel,
      gold: gameState.gold || 0,
      dungeons_cleared: gameState.clearedDungeons?.length || 0,
      game_state: gameState,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,slot' });
    return { data, error };
  }

  async function cloudLoad(slot) {
    if (!supabase || !currentUser) return { error: 'Not logged in' };
    const { data, error } = await supabase.from('save_games')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('slot', slot)
      .single();
    return { data: data?.game_state, error };
  }

  async function cloudListSaves() {
    if (!supabase || !currentUser) return { data: [] };
    const { data, error } = await supabase.from('save_games')
      .select('slot, party_name, avg_level, gold, dungeons_cleared, updated_at')
      .eq('user_id', currentUser.id)
      .order('slot');
    return { data: data || [], error };
  }

  // Leaderboard functions
  async function updateLeaderboard(gameState) {
    if (!supabase || !currentUser) return;
    const s = gameState.stats || {};
    const avgLevel = gameState.party?.length > 0
      ? Math.round(gameState.party.reduce((sum, m) => sum + m.level, 0) / gameState.party.length)
      : 0;
    await supabase.from('leaderboard').upsert({
      user_id: currentUser.id,
      party_name: gameState.partyName || 'Unnamed Party',
      avg_level: avgLevel,
      deepest_dungeon: s.deepestDungeon || '',
      monsters_killed: s.monstersKilled || 0,
      bosses_killed: s.bossesKilled || 0,
      total_gold_earned: s.totalGoldEarned || 0,
      total_xp_earned: s.totalXpEarned || 0,
      deaths: s.deaths || 0,
      dungeon_runs: s.dungeonRuns || 0,
      party_classes: gameState.party?.map(m => m.classId) || [],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,party_name' });
  }

  async function getLeaderboard(sortBy, limit) {
    if (!supabase) return { data: [] };
    const { data, error } = await supabase.from('leaderboard')
      .select('*')
      .order(sortBy || 'avg_level', { ascending: false })
      .limit(limit || 20);
    return { data: data || [], error };
  }

  // Global class stats
  async function updateClassStats(classDps) {
    if (!supabase || !classDps) return;
    for (const [classId, stats] of Object.entries(classDps)) {
      await supabase.from('global_class_stats').upsert({
        class_id: classId,
        total_damage: stats.totalDamage || 0,
        total_healing: stats.totalHealing || 0,
        total_damage_taken: stats.totalDamageTaken || 0,
        total_kills: stats.kills || 0,
        total_combats: stats.combats || 0,
        total_turns: stats.totalTurns || 0,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'class_id' });
    }
  }

  async function getGlobalClassStats() {
    if (!supabase) return { data: [] };
    const { data, error } = await supabase.from('global_class_stats')
      .select('*')
      .order('total_damage', { ascending: false });
    return { data: data || [], error };
  }

  function isLoggedIn() { return !!currentUser; }
  function getUser() { return currentUser; }

  return {
    init, signUp, signIn, signOut,
    cloudSave, cloudLoad, cloudListSaves,
    updateLeaderboard, getLeaderboard,
    updateClassStats, getGlobalClassStats,
    isLoggedIn, getUser, updateAuthUI,
  };
})();
