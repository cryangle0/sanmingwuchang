import {
  MAP_BOUNDARY,
  MAP_GEOMETRY_HASH,
  MAP_STRUCTURE_PIECES,
  MAP_STRUCTURES_HASH,
  MAP_WALL_PIECES,
} from '@jwgb/content';
import { MapCollisionField } from './map-collision-field';

/**
 * The authoritative collision field for the compiled map: the boundary ring,
 * the authored wall pieces and the building footprints. Every host — server,
 * local browser sim and debug spawn probes — goes through here so nobody can
 * forget the buildings and let a player walk through a hall.
 */
export function createMapCollisionField(): MapCollisionField {
  return new MapCollisionField(
    `${MAP_GEOMETRY_HASH}+structures:${MAP_STRUCTURES_HASH}`,
    MAP_BOUNDARY,
    [...MAP_WALL_PIECES, ...MAP_STRUCTURE_PIECES],
  );
}
