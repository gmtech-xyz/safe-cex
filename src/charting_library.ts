/* eslint-disable @typescript-eslint/naming-convention */

export declare type Nominal<T, Name extends string> = T & {
  [Symbol.species]: Name;
};

export type ErrorCallback = (reason: string) => void;

export type Timezone = CustomTimezones | 'Etc/UTC';
export type SeriesFormat = 'price' | 'volume';
export type ResolutionString = Nominal<string, 'ResolutionString'>;
export type LibrarySessionId =
  | 'extended'
  | 'postmarket'
  | 'premarket'
  | 'regular';

export type VisiblePlotsSet = 'c' | 'ohlc' | 'ohlcv';
export type GetMarksCallback<T> = (marks: T[]) => void;

export type MarkConstColors = 'blue' | 'green' | 'red' | 'yellow';
export type SearchSymbolsCallback = (items: SearchSymbolResultItem[]) => void;
export type TimeScaleMarkShape =
  | 'circle'
  | 'earning'
  | 'earningDown'
  | 'earningUp';

export interface LibrarySubsessionInfo {
  description: string;
  id: LibrarySessionId;
  session: string;
  'session-correction'?: string;
  'session-display'?: string;
}

export interface SymbolInfoPriceSource {
  id: string;
  name: string;
}

export interface LibrarySymbolInfo {
  name: string;
  base_name?: [string];
  ticker?: string;
  description: string;
  long_description?: string;
  type: string;
  session: string;
  session_display?: string;
  session_holidays?: string;
  corrections?: string;
  exchange: string;
  listed_exchange: string;
  timezone: Timezone;
  format: SeriesFormat;
  pricescale: number;
  minmov: number;
  fractional?: boolean;
  minmove2?: number;
  variable_tick_size?: string;
  has_intraday?: boolean;
  supported_resolutions?: ResolutionString[];
  intraday_multipliers?: string[];
  has_seconds?: boolean;
  has_ticks?: boolean;
  seconds_multipliers?: string[];
  has_daily?: boolean;
  daily_multipliers?: string[];
  has_weekly_and_monthly?: boolean;
  weekly_multipliers?: string[];
  monthly_multipliers?: string[];
  has_empty_bars?: boolean;
  visible_plots_set?: VisiblePlotsSet;
  volume_precision?: number;
  data_status?: 'delayed_streaming' | 'endofday' | 'streaming';
  delay?: number;
  expired?: boolean;
  expiration_date?: number;
  sector?: string;
  industry?: string;
  currency_code?: string;
  original_currency_code?: string;
  unit_id?: string;
  original_unit_id?: string;
  unit_conversion_types?: string[];
  subsession_id?: string;
  subsessions?: LibrarySubsessionInfo[];
  price_source_id?: string;
  price_sources?: SymbolInfoPriceSource[];
  logo_urls?: [string, string] | [string];
  exchange_logo?: string;
}

export interface MarkCustomColor {
  border: string;
  background: string;
}

export interface Mark {
  id: number | string;
  time: number;
  color: MarkConstColors | MarkCustomColor;
  text: string;
  label: string;
  labelFontColor: string;
  minSize: number;
  borderWidth?: number;
  hoveredBorderWidth?: number;
  imageUrl?: string;
  showLabelWhenImageLoaded?: boolean;
}

export interface SearchSymbolResultItem {
  symbol: string;
  full_name: string;
  description: string;
  exchange: string;
  ticker?: string;
  type: string;
  logo_urls?: [string, string] | [string];
  exchange_logo?: string;
}

export interface TimescaleMark {
  id: number | string;
  time: number;
  color: MarkConstColors | string;
  labelFontColor?: MarkConstColors | string;
  label: string;
  tooltip: string[];
  shape?: TimeScaleMarkShape;
  imageUrl?: string;
  showLabelWhenImageLoaded?: boolean;
}

export type ServerTimeCallback = (serverTime: number) => void;
export type ResolveCallback = (symbolInfo: LibrarySymbolInfo) => void;

export interface SymbolResolveExtension {
  currencyCode?: string;
  unitId?: string;
  session?: string;
}

export interface PeriodParams {
  from: number;
  to: number;
  countBack: number;
  firstDataRequest: boolean;
}

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface HistoryMetadata {
  noData?: boolean;
  nextTime?: number | null;
}

export interface DOMLevel {
  price: number;
  volume: number;
}

export interface DOMData {
  snapshot: boolean;
  asks: DOMLevel[];
  bids: DOMLevel[];
}

export type HistoryCallback = (bars: Bar[], meta?: HistoryMetadata) => void;
export type SubscribeBarsCallback = (bar: Bar) => void;
export type DOMCallback = (data: DOMData) => void;

export interface IDatafeedChartApi {
  getMarks?: (
    symbolInfo: LibrarySymbolInfo,
    from: number,
    to: number,
    onDataCallback: GetMarksCallback<Mark>,
    resolution: ResolutionString
  ) => void;
  getTimescaleMarks?: (
    symbolInfo: LibrarySymbolInfo,
    from: number,
    to: number,
    onDataCallback: GetMarksCallback<TimescaleMark>,
    resolution: ResolutionString
  ) => void;
  getServerTime?: (callback: ServerTimeCallback) => void;
  searchSymbols: (
    userInput: string,
    exchange: string,
    symbolType: string,
    onResult: SearchSymbolsCallback
  ) => void;
  resolveSymbol: (
    symbolName: string,
    onResolve: ResolveCallback,
    onError: ErrorCallback,
    extension?: SymbolResolveExtension
  ) => void;
  getBars: (
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    periodParams: PeriodParams,
    onResult: HistoryCallback,
    onError: ErrorCallback
  ) => void;
  subscribeBars: (
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    onTick: SubscribeBarsCallback,
    listenerGuid: string,
    onResetCacheNeededCallback: () => void
  ) => void;
  unsubscribeBars: (listenerGuid: string) => void;
  subscribeDepth?: (symbol: string, callback: DOMCallback) => string;
  unsubscribeDepth?: (subscriberUID: string) => void;
  getVolumeProfileResolutionForPeriod?: (
    currentResolution: ResolutionString,
    from: number,
    to: number,
    symbolInfo: LibrarySymbolInfo
  ) => ResolutionString;
}

export interface Exchange {
  value: string;
  name: string;
  desc: string;
}

export interface Unit {
  id: string;
  name: string;
  description: string;
}

export interface CurrencyItem {
  id: string;
  code: string;
  logoUrl?: string;
  description?: string;
}

export interface DatafeedSymbolType {
  name: string;
  value: string;
}

export interface DatafeedConfiguration {
  exchanges?: Exchange[];
  supported_resolutions?: ResolutionString[];
  units?: Record<string, Unit[]>;
  currency_codes?: Array<CurrencyItem | string>;
  supports_marks?: boolean;
  supports_time?: boolean;
  supports_timescale_marks?: boolean;
  symbols_types?: DatafeedSymbolType[];
  symbols_grouping?: Record<string, string>;
}

export type OnReadyCallback = (configuration: DatafeedConfiguration) => void;

export interface IExternalDatafeed {
  onReady: (callback: OnReadyCallback) => void;
}

export type IBasicDataFeed = IDatafeedChartApi & IExternalDatafeed;

export type CustomTimezones =
  | 'Africa/Cairo'
  | 'Africa/Casablanca'
  | 'Africa/Johannesburg'
  | 'Africa/Lagos'
  | 'Africa/Nairobi'
  | 'Africa/Tunis'
  | 'America/Anchorage'
  | 'America/Argentina/Buenos_Aires'
  | 'America/Bogota'
  | 'America/Caracas'
  | 'America/Chicago'
  | 'America/El_Salvador'
  | 'America/Juneau'
  | 'America/Lima'
  | 'America/Los_Angeles'
  | 'America/Mexico_City'
  | 'America/New_York'
  | 'America/Phoenix'
  | 'America/Santiago'
  | 'America/Sao_Paulo'
  | 'America/Toronto'
  | 'America/Vancouver'
  | 'Asia/Almaty'
  | 'Asia/Ashkhabad'
  | 'Asia/Bahrain'
  | 'Asia/Bangkok'
  | 'Asia/Chongqing'
  | 'Asia/Colombo'
  | 'Asia/Dhaka'
  | 'Asia/Dubai'
  | 'Asia/Ho_Chi_Minh'
  | 'Asia/Hong_Kong'
  | 'Asia/Jakarta'
  | 'Asia/Jerusalem'
  | 'Asia/Karachi'
  | 'Asia/Kathmandu'
  | 'Asia/Kolkata'
  | 'Asia/Kuwait'
  | 'Asia/Manila'
  | 'Asia/Muscat'
  | 'Asia/Nicosia'
  | 'Asia/Qatar'
  | 'Asia/Riyadh'
  | 'Asia/Seoul'
  | 'Asia/Shanghai'
  | 'Asia/Singapore'
  | 'Asia/Taipei'
  | 'Asia/Tehran'
  | 'Asia/Tokyo'
  | 'Asia/Yangon'
  | 'Atlantic/Reykjavik'
  | 'Australia/Adelaide'
  | 'Australia/Brisbane'
  | 'Australia/Perth'
  | 'Australia/Sydney'
  | 'Europe/Amsterdam'
  | 'Europe/Athens'
  | 'Europe/Belgrade'
  | 'Europe/Berlin'
  | 'Europe/Bratislava'
  | 'Europe/Brussels'
  | 'Europe/Bucharest'
  | 'Europe/Budapest'
  | 'Europe/Copenhagen'
  | 'Europe/Dublin'
  | 'Europe/Helsinki'
  | 'Europe/Istanbul'
  | 'Europe/Lisbon'
  | 'Europe/London'
  | 'Europe/Luxembourg'
  | 'Europe/Madrid'
  | 'Europe/Malta'
  | 'Europe/Moscow'
  | 'Europe/Oslo'
  | 'Europe/Paris'
  | 'Europe/Prague'
  | 'Europe/Riga'
  | 'Europe/Rome'
  | 'Europe/Stockholm'
  | 'Europe/Tallinn'
  | 'Europe/Vienna'
  | 'Europe/Vilnius'
  | 'Europe/Warsaw'
  | 'Europe/Zurich'
  | 'Pacific/Auckland'
  | 'Pacific/Chatham'
  | 'Pacific/Fakaofo'
  | 'Pacific/Honolulu'
  | 'Pacific/Norfolk'
  | 'US/Mountain';
