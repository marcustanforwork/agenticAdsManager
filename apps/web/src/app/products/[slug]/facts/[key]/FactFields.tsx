// The fields for one part of the fact schema (lib/factsForm.ts names them and reads them back).
import { type FactNode, fieldName } from '../../../../../lib/factsForm.ts';
import { microsToInput } from '../../../../../lib/forms.ts';

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** A value as the form shows it: text as is, anything else as JSON. */
const asText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));
const label = (key: string): string => key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

export function FactFields({
  node,
  value,
  path,
  name,
  required,
}: {
  node: FactNode;
  value: unknown;
  path: string[];
  name: string;
  required: boolean;
}) {
  const field = fieldName(path);
  const caption = `${label(name)}${required ? '' : ' (optional)'}`;
  switch (node.kind) {
    case 'object': {
      const v = isObject(value) ? value : {};
      const inner = node.props.map((p) => (
        <FactFields key={p.key} node={p.node} value={v[p.key]} path={[...path, p.key]} name={p.key} required={p.required} />
      ));
      return path.length === 0 ? (
        <>{inner}</>
      ) : (
        <fieldset>
          <legend>{caption}</legend>
          {inner}
        </fieldset>
      );
    }
    case 'list': {
      const items: unknown[] = Array.isArray(value) ? (value as unknown[]) : [];
      if (node.item.kind !== 'object' && node.item.kind !== 'list') {
        return (
          <label>
            {caption}, one per line
            <textarea name={field} defaultValue={items.map(asText).join('\n')} />
          </label>
        );
      }
      const canAdd = node.maxItems === null || items.length < node.maxItems;
      return (
        <fieldset>
          <legend>{caption}</legend>
          {[...items, ...(canAdd ? [undefined] : [])].map((item, i) => (
            <fieldset key={i}>
              <legend>{item === undefined ? 'Add one' : `#${i + 1}`}</legend>
              <FactFields node={node.item} value={item} path={[...path, String(i)]} name={name} required={false} />
              {item !== undefined && (
                <label>
                  <input type="checkbox" name={`${field}.${i}.__remove`} /> remove
                </label>
              )}
            </fieldset>
          ))}
        </fieldset>
      );
    }
    case 'text': {
      const text =
        value === null || value === undefined ? '' : node.money ? microsToInput(asText(value)) : asText(value);
      const hint = node.money ? (node.nullable ? 'amount; blank = none' : 'amount') : node.nullable ? 'blank = none' : '';
      return (
        <label>
          <span>{caption}</span>
          {node.options === null ? (
            <input name={field} defaultValue={text} placeholder={hint} maxLength={node.maxLength ?? undefined} />
          ) : (
            <select name={field} defaultValue={text}>
              <option value="">—</option>
              {node.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
        </label>
      );
    }
    case 'number':
      return (
        <label>
          <span>{caption}</span>
          <input name={field} inputMode="decimal" defaultValue={value === undefined || value === null ? '' : asText(value)} />
        </label>
      );
    case 'boolean':
      return (
        <label>
          <input type="checkbox" name={field} defaultChecked={value === true} /> {caption}
        </label>
      );
    case 'unsupported':
      return (
        <label>
          {caption} (JSON)
          <textarea name={field} defaultValue={value === undefined ? '' : JSON.stringify(value, null, 2)} />
        </label>
      );
  }
}
