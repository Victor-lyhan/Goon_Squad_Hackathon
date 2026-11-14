import { LAYERS, type LayerKey, type LayerVisibility } from './workspaceModel';

export type LayerTogglesProps = { layers: LayerVisibility; onToggle: (key: LayerKey) => void };

/** Four labelled checkboxes that show or hide the map layers. */
export function LayerToggles({ layers, onToggle }: LayerTogglesProps) {
  return (
    <fieldset className="sw-layers">
      <legend className="sw-visually-hidden">Map layers</legend>
      {LAYERS.map(({ key, label }) => (
        <label key={key} className="sw-check">
          <input type="checkbox" name={`layer-${key}`} checked={layers[key]} onChange={() => onToggle(key)} />
          <span>{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
