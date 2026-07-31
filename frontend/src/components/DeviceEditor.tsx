import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Device, MultichannelChannel, Output } from "@rtl-airband-panel/parser";
import { RTLSDR_COMMON_SAMPLE_RATES_HZ } from "@rtl-airband-panel/validate";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BoolField, Field } from "./Field.js";
import { Collapsible } from "./Collapsible.js";
import { ChannelEditor } from "./ChannelEditor.js";
import { ScanChannelEditor } from "./ScanChannelEditor.js";
import { addButtonClass, inputClass, removeButtonClass, responsiveGrid3 } from "./styles.js";
import { appendItem, duplicateAt, moveAt, removeAt, updateAt } from "../lib/array-utils.js";
import { defaultChannel, defaultScanChannel, restoreModeFields, restoreTypeFields } from "../lib/defaults.js";
import { formatMsps, numberOrUndefined } from "../lib/number-utils.js";
import { cloneWithNewUiKeys, uiKeyOf } from "../lib/keys.js";
import { pathStartsWith } from "../lib/validation-path.js";
import { DEVICE_TOOLTIPS } from "../lib/config-descriptions.js";
import { isMultichannelChannel, isScanChannel, type ChannelTarget } from "../lib/channel-targets.js";

/**
 * Owns the per-row useSortable() call (each row needs its own -- hooks can't run in a
 * .map() loop directly), and hands the drag handle to its render-prop child instead of
 * wrapping it in a separate sibling column. The handle needs to live inside
 * ChannelEditor's own Collapsible header row (see its dragHandle prop) to stay centered
 * against the title at any header height -- a fixed sibling column can only ever be
 * centered against one specific height, and drifts the moment the header wraps to two
 * lines or the channel is expanded.
 */
function SortableChannelRow({ id, children }: { id: string | number; children: (dragHandle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const dragHandle = (
    <button
      type="button"
      {...attributes}
      {...listeners}
      // p-3 (not p-2) brings this closer to the ~44px touch-target guideline that
      // matters now that touch-drag (TouchSensor, below) is a real, tuned input path,
      // not just tolerated incidentally by the pointer sensor.
      className="cursor-grab select-none rounded p-3 text-lg leading-none text-slate-500 hover:text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 active:cursor-grabbing"
      aria-label="Drag to reorder channel, or focus and use arrow keys"
      title="Drag to reorder (or focus and use arrow keys)"
    >
      ⠿
    </button>
  );
  return (
    <div ref={setNodeRef} style={style}>
      {children(dragHandle)}
    </div>
  );
}

/** Matches a channel search filter against frequency (MHz or raw Hz), label, and modulation. */
function channelMatchesFilter(channel: MultichannelChannel, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (f === "") return true;
  return (
    (channel.freq / 1e6).toFixed(4).includes(f) ||
    String(channel.freq).includes(f) ||
    (channel.label?.toLowerCase().includes(f) ?? false) ||
    (channel.modulation?.toLowerCase().includes(f) ?? false)
  );
}

interface DeviceEditorProps {
  device: Device;
  deviceIndex: number;
  onChange: (device: Device) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  pathPrefix: string;
  jumpTarget?: { path: string; nonce: number } | null;
  onRevealSecret?: (fieldPath: string) => Promise<string>;
  /** Every channel an output can be copied to, across the whole instance -- see OutputEditor. */
  channelTargets: ChannelTarget[];
  onCopyOutputToChannel: (output: Output, target: ChannelTarget) => void;
}

const DEVICE_TYPES = ["rtlsdr", "mirisdr", "soapysdr"] as const;

function gainToText(gain: number | string | undefined): string {
  return gain === undefined ? "" : String(gain);
}

/** Numeric-looking gain text (e.g. rtlsdr's "29") becomes a number; anything else (e.g. SoapySDR's "LNA=32,VGA=20") stays a string. */
function parseGain(text: string): number | string | undefined {
  if (text === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) && text.trim() !== "" ? n : text;
}

export function DeviceEditor({
  device,
  deviceIndex,
  onChange,
  onRemove,
  onDuplicate,
  pathPrefix,
  jumpTarget,
  onRevealSecret,
  channelTargets,
  onCopyOutputToChannel,
}: DeviceEditorProps) {
  const openSignal = jumpTarget && pathStartsWith(jumpTarget.path, pathPrefix) ? jumpTarget.nonce : undefined;
  const isSoapy = device.type === "soapysdr";
  const isMiri = device.type === "mirisdr";
  const isRtl = device.type === "rtlsdr";
  const isScan = device.mode === "scan";

  // Remembers the last-edited device state for each Type and each Mode visited in this
  // editing session, so flipping either dropdown away and back restores what was there
  // instead of resetting to defaults. Session-only (a ref, not part of the saved config).
  const lastByType = useRef<Partial<Record<string, Device>>>({});
  const lastByMode = useRef<Partial<Record<"multichannel" | "scan", Device>>>({});
  useEffect(() => {
    lastByType.current[device.type] = device;
    lastByMode.current[device.mode === "scan" ? "scan" : "multichannel"] = device;
  }, [device]);

  // Keeps each channel's real index in device.channels (needed by onChange/onRemove/
  // onDuplicate below) alongside the filtered view, so filtering never renumbers edits.
  const [channelFilter, setChannelFilter] = useState("");
  // A jump-to-field click should win over an active filter -- otherwise clicking a
  // validation error for a channel the filter currently hides would silently do nothing.
  useEffect(() => {
    if (openSignal) setChannelFilter("");
  }, [openSignal]);
  const indexedChannels = device.channels
    .map((channel, i) => ({ channel, i }))
    .filter((entry): entry is { channel: MultichannelChannel; i: number } => isMultichannelChannel(entry.channel));
  const visibleChannels = indexedChannels.filter(({ channel }) => channelMatchesFilter(channel, channelFilter));

  // Forces the sample-rate field into free-text "Custom" mode even if the user types
  // their way back to a value that happens to match a curated rate -- otherwise the
  // input would jump back to dropdown mode mid-edit, which is disorienting. Reset to
  // false (deriving from the value instead) whenever the dropdown itself picks a
  // curated rate or "Default".
  const [forceCustomSampleRate, setForceCustomSampleRate] = useState(false);
  const isCuratedSampleRate = device.sample_rate === undefined || RTLSDR_COMMON_SAMPLE_RATES_HZ.includes(device.sample_rate);
  const showCustomSampleRate = forceCustomSampleRate || !isCuratedSampleRate;

  // Briefly highlights a just-duplicated channel so it's obvious which one is new,
  // rather than leaving the user to spot it among the rest of the list. Cleared by
  // timeout rather than left to fade indefinitely -- matches jumpTarget's "signal
  // that resolves itself" shape, just kept local since nothing outside this
  // component needs to know about it.
  const [justDuplicatedKey, setJustDuplicatedKey] = useState<string | number | null>(null);
  useEffect(() => {
    if (justDuplicatedKey === null) return;
    const timeout = setTimeout(() => setJustDuplicatedKey(null), 2500);
    return () => clearTimeout(timeout);
  }, [justDuplicatedKey]);

  // MouseSensor/TouchSensor (rather than a single PointerSensor for both) so each input
  // modality gets its own activation constraint -- a touch needs a short press-and-hold
  // (delay/tolerance) so a vertical swipe-to-scroll on the channel list isn't mistaken
  // for a drag-start, whereas a mouse can start dragging immediately after a small
  // move (distance). Registering PointerSensor alongside TouchSensor instead would
  // double up: modern touchscreens fire both pointer and touch events for the same
  // gesture, so the two sensors would race for the same interaction.
  // KeyboardSensor makes reordering possible without a mouse/touch at all -- without it,
  // a keyboard-only user simply has no way to reorder channels.
  const dragSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Drag-and-drop reorders device.channels itself (by real index), not the currently-
  // rendered/filtered view -- so a reorder is well-defined even while a filter narrows
  // which rows are shown.
  function handleChannelDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = visibleChannels.find(({ channel, i }) => uiKeyOf(channel, i) === active.id);
    const to = visibleChannels.find(({ channel, i }) => uiKeyOf(channel, i) === over.id);
    if (!from || !to) return;
    onChange({ ...device, channels: moveAt(device.channels, from.i, to.i) });
  }

  return (
    <Collapsible
      openSignal={openSignal}
      className="rounded-lg border border-slate-700 bg-slate-900 p-4"
      titleClassName="text-lg font-semibold text-slate-100"
      title={
        <>
          Device — {device.type}
          {device.centerfreq !== undefined ? ` (${(device.centerfreq / 1e6).toFixed(3)} MHz)` : ""}
        </>
      }
      headerActions={
        <div className="flex items-center gap-3">
          <BoolField label="Disable" tooltip={DEVICE_TOOLTIPS.disable} checked={device.disable} onChange={(v) => onChange({ ...device, disable: v })} />
          <button type="button" onClick={onDuplicate} className={addButtonClass}>
            Duplicate device
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Remove device — ${device.type}? This also deletes all of its channels and outputs.`)) onRemove();
            }}
            className={removeButtonClass}
          >
            Remove device
          </button>
        </div>
      }
    >
      <div className={responsiveGrid3}>
        <Field label="Type" tooltip={DEVICE_TOOLTIPS.type}>
          <select
            className={inputClass}
            value={device.type}
            onChange={(e) => onChange(restoreTypeFields(device, lastByType.current[e.target.value], e.target.value))}
          >
            {DEVICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mode (blank = default: multichannel)" tooltip={DEVICE_TOOLTIPS.mode}>
          <select
            className={inputClass}
            value={device.mode ?? ""}
            onChange={(e) => {
              const mode = (e.target.value || undefined) as Device["mode"];
              const modeKey = mode === "scan" ? "scan" : "multichannel";
              onChange(restoreModeFields(device, lastByMode.current[modeKey], mode));
            }}
          >
            <option value="">(default: multichannel)</option>
            <option value="multichannel">multichannel</option>
            <option value="scan">scan</option>
          </select>
        </Field>
        {!isSoapy && (
          <>
            <Field label="Serial (optional if index is set)" tooltip={DEVICE_TOOLTIPS.serial}>
              <input
                className={inputClass}
                value={device.serial ?? ""}
                onChange={(e) => onChange({ ...device, serial: e.target.value || undefined })}
              />
            </Field>
            <Field label="Index (optional, used if serial is blank; default 0)" tooltip={DEVICE_TOOLTIPS.index}>
              <input
                type="number"
                className={inputClass}
                value={device.index ?? ""}
                onChange={(e) => onChange({ ...device, index: numberOrUndefined(e.target.value) })}
              />
            </Field>
          </>
        )}
        <Field
          label={isSoapy ? "Gain (number, or 'component=value' pairs; blank = AGC)" : "Gain"}
          tooltip={isSoapy ? DEVICE_TOOLTIPS.gainSoapy : DEVICE_TOOLTIPS.gain}
        >
          <input className={inputClass} value={gainToText(device.gain)} onChange={(e) => onChange({ ...device, gain: parseGain(e.target.value) })} />
        </Field>
        {!isScan && (
          <Field label="Center frequency (Hz)" tooltip={DEVICE_TOOLTIPS.centerfreq}>
            <input
              type="number"
              className={inputClass}
              value={device.centerfreq ?? ""}
              onChange={(e) => onChange({ ...device, centerfreq: numberOrUndefined(e.target.value) })}
            />
          </Field>
        )}
        {isRtl ? (
          <Field label="Sample rate (MSPS, blank = default 2.560)" tooltip={DEVICE_TOOLTIPS.sampleRate}>
            {showCustomSampleRate ? (
              <input
                type="number"
                min="16001"
                className={inputClass}
                value={device.sample_rate ?? ""}
                onChange={(e) => onChange({ ...device, sample_rate: numberOrUndefined(e.target.value) })}
              />
            ) : (
              <select
                className={inputClass}
                value={device.sample_rate === undefined ? "default" : String(device.sample_rate)}
                onChange={(e) => {
                  if (e.target.value === "custom") {
                    setForceCustomSampleRate(true);
                    return;
                  }
                  setForceCustomSampleRate(false);
                  onChange({ ...device, sample_rate: e.target.value === "default" ? undefined : Number(e.target.value) });
                }}
              >
                <option value="default">Default (2.560 MSPS)</option>
                {RTLSDR_COMMON_SAMPLE_RATES_HZ.map((hz) => (
                  <option key={hz} value={hz}>
                    {formatMsps(hz)} MSPS
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            )}
          </Field>
        ) : (
          <Field label="Sample rate (Hz, blank = default 2,560,000)" tooltip={DEVICE_TOOLTIPS.sampleRate}>
            <input
              type="number"
              min="16001"
              className={inputClass}
              value={device.sample_rate ?? ""}
              onChange={(e) => onChange({ ...device, sample_rate: numberOrUndefined(e.target.value) })}
            />
          </Field>
        )}
        <Field
          label={isMiri ? "Correction (Hz, blank = default 0)" : "Correction (ppm, blank = default 0)"}
          tooltip={isMiri ? DEVICE_TOOLTIPS.correctionHz : DEVICE_TOOLTIPS.correctionPpm}
        >
          <input
            type="number"
            className={inputClass}
            value={device.correction ?? ""}
            onChange={(e) => onChange({ ...device, correction: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="Tau, µs (optional; NFM deemphasis, overrides global)" tooltip={DEVICE_TOOLTIPS.tauDevice}>
          <input
            type="number"
            className={inputClass}
            value={device.tau ?? ""}
            onChange={(e) => onChange({ ...device, tau: numberOrUndefined(e.target.value) })}
          />
        </Field>

        {isRtl && (
          <Field label="Buffers (optional, default 10)" tooltip={DEVICE_TOOLTIPS.buffers}>
            <input
              type="number"
              min="1"
              step="1"
              className={inputClass}
              value={device.buffers ?? ""}
              onChange={(e) => onChange({ ...device, buffers: numberOrUndefined(e.target.value) })}
            />
          </Field>
        )}
        {isMiri && (
          <Field label="Num buffers (optional, default 10)" tooltip={DEVICE_TOOLTIPS.numBuffers}>
            <input
              type="number"
              min="1"
              step="1"
              className={inputClass}
              value={device.num_buffers ?? ""}
              onChange={(e) => onChange({ ...device, num_buffers: numberOrUndefined(e.target.value) })}
            />
          </Field>
        )}
        {isSoapy && (
          <>
            <Field label="Device string (required, e.g. 'driver=rtlsdr,serial=00000001')" tooltip={DEVICE_TOOLTIPS.deviceString}>
              <input
                className={inputClass}
                value={device.device_string ?? ""}
                onChange={(e) => onChange({ ...device, device_string: e.target.value || undefined })}
              />
            </Field>
            <Field label="Channel (optional, default 0)" tooltip={DEVICE_TOOLTIPS.channel}>
              <input
                type="number"
                className={inputClass}
                value={device.channel ?? ""}
                onChange={(e) => onChange({ ...device, channel: numberOrUndefined(e.target.value) })}
              />
            </Field>
            <Field label="Antenna (optional)" tooltip={DEVICE_TOOLTIPS.antenna}>
              <input
                className={inputClass}
                value={device.antenna ?? ""}
                onChange={(e) => onChange({ ...device, antenna: e.target.value || undefined })}
              />
            </Field>
          </>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-medium text-slate-300">Channels</h4>
          <div className="flex flex-wrap items-center gap-3">
            {!isScan && (
              <input
                type="search"
                className={`${inputClass} w-full sm:w-56`}
                placeholder="Filter by frequency or label…"
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
              />
            )}
            {!isScan && (
              <button
                type="button"
                className={addButtonClass}
                onClick={() => onChange({ ...device, channels: appendItem(device.channels, defaultChannel()) })}
              >
                + Add channel
              </button>
            )}
          </div>
        </div>
        {isScan ? (
          <ScanChannelEditor
            channel={device.channels.find(isScanChannel) ?? defaultScanChannel()}
            deviceIndex={deviceIndex}
            channelIndex={0}
            onChange={(next) => onChange({ ...device, channels: [next] })}
            pathPrefix={`${pathPrefix}.channels[0]`}
            jumpTarget={jumpTarget}
            onRevealSecret={onRevealSecret}
            channelTargets={channelTargets}
            onCopyOutputToChannel={onCopyOutputToChannel}
          />
        ) : (
          <>
            {channelFilter.trim() !== "" && (
              <p className="text-xs text-slate-400">
                Showing {visibleChannels.length} of {indexedChannels.length} channels.
              </p>
            )}
            <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={handleChannelDragEnd}>
              <SortableContext items={visibleChannels.map(({ channel, i }) => uiKeyOf(channel, i))} strategy={verticalListSortingStrategy}>
                {visibleChannels.map(({ channel, i }) => (
                  <SortableChannelRow key={uiKeyOf(channel, i)} id={uiKeyOf(channel, i)}>
                    {(dragHandle) => (
                      <ChannelEditor
                        channel={channel}
                        deviceIndex={deviceIndex}
                        channelIndex={i}
                        highlighted={justDuplicatedKey !== null && uiKeyOf(channel, i) === justDuplicatedKey}
                        dragHandle={dragHandle}
                        onChange={(next) => onChange({ ...device, channels: updateAt(device.channels, i, next) })}
                        onRemove={() => onChange({ ...device, channels: removeAt(device.channels, i) })}
                        onDuplicate={() => {
                          const nextChannels = duplicateAt(device.channels, i, cloneWithNewUiKeys);
                          onChange({ ...device, channels: nextChannels });
                          setJustDuplicatedKey(uiKeyOf(nextChannels[i + 1]!, i + 1));
                        }}
                        pathPrefix={`${pathPrefix}.channels[${i}]`}
                        jumpTarget={jumpTarget}
                        onRevealSecret={onRevealSecret}
                        channelTargets={channelTargets}
                        onCopyOutputToChannel={onCopyOutputToChannel}
                      />
                    )}
                  </SortableChannelRow>
                ))}
              </SortableContext>
            </DndContext>
          </>
        )}
      </div>
    </Collapsible>
  );
}
