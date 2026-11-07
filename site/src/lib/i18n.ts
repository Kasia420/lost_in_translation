import type { Lang } from './data'

/**
 * UI strings for the language switch. PL strings are DRAFTS for Kasia to
 * correct; narrative text (chapter intros, interpretation) is hers to write.
 */
export const TITLE: Record<Lang, string> = {
  en: 'Lost in Translation',
  pl: 'Zagubione w tłumaczeniu', // draft: alternatives listed in the review section
}

export const UI = {
  en: {
    kicker: 'One model · two languages · 25 Polish topics',
    begin: 'Scroll to begin',
    replay: 'Replay intro',
    loading: 'loading data',
    questionNote: '',
  },
  pl: {
    kicker: 'Jeden model · dwa języki · 25 polskich tematów',
    begin: 'Przewiń, aby zacząć',
    replay: 'Odtwórz intro',
    loading: 'wczytywanie danych',
    questionNote: 'Pytanie badawcze po polsku: do napisania przez Kasię',
  },
} satisfies Record<Lang, Record<string, string>>

export type UIKey = keyof (typeof UI)['en']
