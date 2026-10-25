import vocabulary600 from './data/600-vocabulary.json' with { type: 'json' };
import vocabulary730 from './data/730-vocabulary.json' with { type: 'json' };
import vocabulary860 from './data/860-vocabulary.json' with { type: 'json' };
import vocabulary990 from './data/990-vocabulary.json' with { type: 'json' };

export const vocabulary = [

];

vocabulary.push(...vocabulary600, ...vocabulary730, ...vocabulary860, ...vocabulary990);

export const levels = [600, 730, 860, 990];
export const storageKey = 'lexi-toeic-v1';
export const freshState = () => ({ level: 600, learned: [], mastered: [], favorites: [], wrong: [], reviews: {}, weekMinutes: 0, lastSession: null, history: {} });
