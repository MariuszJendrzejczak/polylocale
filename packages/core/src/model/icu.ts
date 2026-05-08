/**
 * ICU MessageFormat — Internal Representation (IR).
 *
 * Strukturalne drzewo node'ów, format-agnostyczne. Parser format-specyficzny
 * (ARB, JSON) buduje IR; exporter renderuje IR z powrotem do stringa danego
 * formatu. AI translation operuje na IR — placeholdery i konstrukcje plural/
 * select są chronione z definicji (translator widzi tylko `text` node'y).
 */

export type ICUNode = ICUText | ICUPlaceholder | ICUPlural | ICUSelect | ICUSelectOrdinal | ICUTag;

export interface ICUText {
  readonly kind: 'text';
  readonly value: string;
}

export interface ICUPlaceholder {
  readonly kind: 'placeholder';
  readonly name: string;
  readonly type?: string;
  readonly format?: string;
}

export interface ICUPlural {
  readonly kind: 'plural';
  readonly arg: string;
  readonly cases: Readonly<Record<string, readonly ICUNode[]>>;
  readonly offset?: number;
}

export interface ICUSelect {
  readonly kind: 'select';
  readonly arg: string;
  readonly cases: Readonly<Record<string, readonly ICUNode[]>>;
}

export interface ICUSelectOrdinal {
  readonly kind: 'selectordinal';
  readonly arg: string;
  readonly cases: Readonly<Record<string, readonly ICUNode[]>>;
}

export interface ICUTag {
  readonly kind: 'tag';
  readonly name: string;
  readonly children: readonly ICUNode[];
}
