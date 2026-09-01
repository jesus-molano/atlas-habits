import { describe, expect, it } from 'vitest';

import {
  ATLAS_ITEM_TYPES,
  atlasItemTypeOptions,
  findAtlasItemType,
} from './item-type-catalog';

describe('item type catalog', () => {
  it('resuelve categorías conocidas sin depender de mayúsculas o espacios', () => {
    expect(findAtlasItemType('  salud ')).toMatchObject({
      id: 'health',
      label: 'Salud',
    });
  });

  it('añade una opción heredada para conservar categorías desconocidas', () => {
    const options = atlasItemTypeOptions('Proyecto personal');

    expect(options[0]).toMatchObject({
      id: 'legacy:Proyecto personal',
      label: 'Proyecto personal',
      legacy: true,
    });
    expect(options).toHaveLength(ATLAS_ITEM_TYPES.length + 1);
  });

  it('no duplica una categoría que ya pertenece al catálogo', () => {
    expect(atlasItemTypeOptions('Trabajo')).toBe(ATLAS_ITEM_TYPES);
  });
});
