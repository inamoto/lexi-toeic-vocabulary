import { supabase } from './supabase.js';

const defaultState = {
  level: 600,
  learned: [],
  mastered: [],
  favorites: [],
  wrong: [],
  reviews: {},
  weekMinutes: 0,
  lastSession: null,
  history: {},
};

function uniqueValues(...lists) {
  return [...new Set(lists.flat().filter(Boolean))];
}

function mergeHistory(localHistory = {}, remoteHistory = {}) {
  const keys = new Set([...Object.keys(localHistory), ...Object.keys(remoteHistory)]);
  return Object.fromEntries([...keys].map(key => [key, {
    answered: Math.max(localHistory[key]?.answered || 0, remoteHistory[key]?.answered || 0),
    minutes: Math.max(localHistory[key]?.minutes || 0, remoteHistory[key]?.minutes || 0),
  }]));
}

export function mergeLearningState(localState = {}, remoteState = {}, remoteLogs = []) {
  const local = { ...defaultState, ...localState };
  const remote = { ...defaultState, ...remoteState };
  const remoteHistory = Object.fromEntries(remoteLogs.map(log => [log.learning_date, {
    answered: log.answered || 0,
    minutes: log.minutes || 0,
  }]));
  const reviews = { ...remote.reviews, ...local.reviews };

  return {
    ...local,
    level: local.level !== defaultState.level ? local.level : remote.level,
    learned: uniqueValues(remote.learned, local.learned),
    mastered: uniqueValues(remote.mastered, local.mastered),
    favorites: uniqueValues(remote.favorites, local.favorites),
    wrong: uniqueValues(remote.wrong, local.wrong),
    reviews,
    weekMinutes: Math.max(local.weekMinutes || 0, remote.weekMinutes || 0),
    lastSession: [local.lastSession, remote.lastSession].filter(Boolean).sort().at(-1) || null,
    history: mergeHistory(mergeHistory(remote.history, remoteHistory), local.history),
  };
}

function stateToRow(userId, state) {
  return {
    user_id: userId,
    level: state.level,
    learned: state.learned,
    mastered: state.mastered,
    favorites: state.favorites,
    wrong: state.wrong,
    reviews: state.reviews,
    week_minutes: state.weekMinutes,
    last_session: state.lastSession,
    updated_at: new Date().toISOString(),
  };
}

function historyToRows(userId, history = {}) {
  return Object.entries(history).map(([learningDate, record]) => ({
    user_id: userId,
    learning_date: learningDate,
    answered: record.answered || 0,
    minutes: record.minutes || 0,
  }));
}

export async function syncLearningData(userId, localState) {
  const [{ data: remoteRow, error: stateError }, { data: remoteLogs, error: logsError }] = await Promise.all([
    supabase.from('user_learning_states').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('daily_learning_logs').select('learning_date, answered, minutes').eq('user_id', userId),
  ]);

  if (stateError) throw stateError;
  if (logsError) throw logsError;

  const mergedState = mergeLearningState(localState, remoteRow || {}, remoteLogs || []);
  await saveLearningData(userId, mergedState);
  return mergedState;
}

export async function saveLearningData(userId, state) {
  const { error: stateError } = await supabase
    .from('user_learning_states')
    .upsert(stateToRow(userId, state), { onConflict: 'user_id' });

  if (stateError) throw stateError;

  const historyRows = historyToRows(userId, state.history);
  if (historyRows.length) {
    const { error: logsError } = await supabase
      .from('daily_learning_logs')
      .upsert(historyRows, { onConflict: 'user_id,learning_date' });

    if (logsError) throw logsError;
  }
}
