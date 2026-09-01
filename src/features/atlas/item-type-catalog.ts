import type { AtlasColorToken } from '@/design';

export type AtlasItemTypeIcon =
  | 'brain'
  | 'briefcase'
  | 'dumbbell'
  | 'graduation-cap'
  | 'heart-pulse'
  | 'house'
  | 'moon-star'
  | 'shapes'
  | 'users'
  | 'wallet';

export type AtlasItemType = Readonly<{
  id: string;
  label: string;
  color: AtlasColorToken;
  icon: AtlasItemTypeIcon;
  legacy?: boolean;
}>;

export const ATLAS_ITEM_TYPES: readonly AtlasItemType[] = [
  { id: 'health', label: 'Salud', color: 'danger', icon: 'heart-pulse' },
  { id: 'movement', label: 'Movimiento', color: 'warning', icon: 'dumbbell' },
  { id: 'mind', label: 'Mente', color: 'primary', icon: 'brain' },
  {
    id: 'work',
    label: 'Trabajo',
    color: 'info',
    icon: 'briefcase',
  },
  {
    id: 'study',
    label: 'Estudios',
    color: 'accent',
    icon: 'graduation-cap',
  },
  { id: 'home', label: 'Hogar', color: 'warning', icon: 'house' },
  {
    id: 'finance',
    label: 'Finanzas',
    color: 'success',
    icon: 'wallet',
  },
  { id: 'social', label: 'Social', color: 'danger', icon: 'users' },
  { id: 'rest', label: 'Descanso', color: 'info', icon: 'moon-star' },
];

function normalizedCategory(value?: string): string {
  return value?.trim().toLocaleLowerCase('es-ES') ?? '';
}

export function findAtlasItemType(
  category?: string,
): AtlasItemType | undefined {
  const normalized = normalizedCategory(category);
  if (!normalized) return undefined;
  return ATLAS_ITEM_TYPES.find(
    (itemType) => normalizedCategory(itemType.label) === normalized,
  );
}

export function atlasItemTypeOptions(
  category?: string,
): readonly AtlasItemType[] {
  const trimmed = category?.trim();
  if (!trimmed || findAtlasItemType(trimmed)) return ATLAS_ITEM_TYPES;

  return [
    {
      id: `legacy:${trimmed}`,
      label: trimmed,
      color: 'textSecondary',
      icon: 'shapes',
      legacy: true,
    },
    ...ATLAS_ITEM_TYPES,
  ];
}
