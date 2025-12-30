
export enum SprayBrand {
  MOLOTOW = 'MOLOTOW',
  MONTANA_COLORS = 'Montana Colors (MTN)',
  MONTANA_CANS = 'Montana Cans (German)'
}

export enum SprayLine {
  MOLOTOW_PREMIUM = 'Premium',
  MTN_94 = '94',
  MTN_HARDCORE = 'Hardcore',
  MONTANA_GOLD = 'Gold',
  MONTANA_BLACK = 'Black'
}

export interface SprayColor {
  brand: SprayBrand;
  line: SprayLine;
  name: string;
  code: string;
  hex: string;
}

export interface ArtworkItem {
  id: string;
  width: number;
  height: number;
  image: string | null;
}

export interface AnalysisResult {
  colorName: string;
  hex: string;
  percentage: number;
  matchedColor?: SprayColor;
  cansRequired: number;
}

export interface EstimationState {
  items: ArtworkItem[];
  brand: SprayBrand;
  line: SprayLine;
  results: AnalysisResult[] | null;
  totalArea: number;
  loading: boolean;
  error: string | null;
}

export interface SavedProject {
  id: string;
  name: string;
  timestamp: number;
  state: EstimationState;
}
