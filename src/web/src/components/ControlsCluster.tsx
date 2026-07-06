import { useState } from "react";
import { LAYERS } from "../data/layers";
import { useAppDispatch, useAppState } from "../state/store";
import { AboutModal } from "./AboutModal";

/**
 * Top-right cluster: wordmark + ABOUT trigger, program segmented control
 * (CalFresh permanently disabled for now), and the layer radio list with the
 * required la-geography citation under Community.
 */
export function ControlsCluster() {
  const { program, layerId } = useAppState();
  const dispatch = useAppDispatch();
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <>
      <div className="panel controls-cluster">
        <div className="controls-group">
          <div className="wordmark-row">
            <div className="wordmark">
              <span className="crosshair-glyph">+</span> Medi-Cal
              <br />
              0–5 Tracker
            </div>
            <button type="button" className="about-trigger" onClick={() => setAboutOpen(true)}>
              About
            </button>
          </div>
        </div>

        <div className="controls-group">
          <div className="micro-label">Program</div>
          <div className="segmented" role="group" aria-label="Program">
            <button
              type="button"
              aria-pressed={program === "medi-cal"}
              onClick={() => dispatch({ type: "setProgram", program: "medi-cal" })}
            >
              Medi-Cal
            </button>
            <button
              type="button"
              aria-pressed={false}
              disabled
              title="CalFresh map data not yet published by this pipeline"
            >
              CalFresh
            </button>
          </div>
        </div>

        <div className="controls-group">
          <div className="micro-label">Boundary layer</div>
          <div className="layer-list" role="radiogroup" aria-label="Boundary layer">
            {LAYERS.map((layer) => (
              <div key={layer.id}>
                <label className="layer-option" data-active={layer.id === layerId}>
                  <input
                    type="radio"
                    name="layer"
                    value={layer.id}
                    checked={layer.id === layerId}
                    onChange={() => dispatch({ type: "setLayer", layerId: layer.id })}
                  />
                  {layer.label}
                </label>
                {layer.id === "community" && (
                  <div className="layer-footnote">
                    Community boundaries from the{" "}
                    <a
                      href="https://github.com/stiles/la-geography"
                      target="_blank"
                      rel="noreferrer"
                    >
                      la-geography
                    </a>{" "}
                    project, a countywide extension of the LA Times Mapping LA neighborhoods.
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </>
  );
}
