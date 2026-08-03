/** What kind of line this was, once the timestamp and author were stripped off. */
export type MessageKind = 'text' | 'media' | 'system' | 'deleted';

/** Which export layout the file used. */
export type ExportFormat = 'ios' | 'android';

/**
 * Which slot of `a/b/c` is the day.
 *
 * This is the single most consequential thing the parser infers. Guess wrong on
 * a `03/08/2024` export and every date silently lands in the wrong month — the
 * chart still renders, it is just wrong. See `inferDateOrder`.
 */
export type DateOrder = 'day-first' | 'month-first' | 'year-first';

export interface ChatMessage {
  /** Epoch milliseconds, built from the export's wall-clock time in the local zone. */
  at: number;
  /** `null` for system notices (encryption banners, "X joined", subject changes). */
  author: string | null;
  /** Message body with the timestamp and author prefix removed. May span lines. */
  text: string;
  kind: MessageKind;
}

export interface ParseWarning {
  code:
    | 'ambiguous-date-order'
    | 'conflicting-date-order'
    | 'unparsed-lines'
    | 'no-messages'
    | 'single-message-authors';
  message: string;
}

export interface ParseResult {
  messages: ChatMessage[];
  format: ExportFormat;
  dateOrder: DateOrder;
  /**
   * True when no date in the file had a day component above 12, so day-vs-month
   * could not be proven and a locale default was assumed. The UI surfaces a
   * toggle when this is set.
   */
  dateOrderAssumed: boolean;
  /** Distinct authors, in first-seen order. */
  authors: string[];
  /** Characters that sat before the first recognised timestamp, or between messages. */
  unparsedChars: number;
  warnings: ParseWarning[];
}
