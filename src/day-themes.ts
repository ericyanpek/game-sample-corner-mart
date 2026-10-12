import SPEC from '../assets/specs/day-themes.json';

export const DAY_THEME_SPEC=SPEC;
export type DayThemeId=keyof typeof SPEC.themes;
export const DAY_THEME_IDS:DayThemeId[]=['breakfast','hot','rush'];
export const DAY_THEMES=SPEC.themes;
export const isDayTheme=(value:unknown):value is DayThemeId=>typeof value==='string'&&DAY_THEME_IDS.includes(value as DayThemeId);
export const dayStorageKey=(theme:DayThemeId)=>'corner-mart-business-day-v1'+(theme==='breakfast'?'':'-'+theme);
