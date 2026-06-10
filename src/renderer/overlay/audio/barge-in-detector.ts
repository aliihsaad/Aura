import { rms } from './energy'
import { getRenderReferenceBus, RenderReferenceBus } from './render-reference-bus'

// Tunables. Starting values — expect to adjust once we A/B against real
// captured system audio.

// Raw mic RMS below this is silence or room noise. Skip detection.
const MIC_FLOOR = 0.01

// Mic must exceed reference RMS by this ratio to count as real user speech
// rather than echo bleed-through from speakers.
const MIC_OVER_REF_RATIO = 2.5

// Consecutive frames above threshold required to open the gate (rising-edge
// debounce). Small so barge-in feels responsive.
const OPEN_FRAMES = 2

// Consecutive frames below threshold required to close the gate
// (falling-edge debounce). Longer than OPEN_FRAMES so the gate doesn't flap
// mid-utterance during short syllable gaps.
const CLOSE_FRAMES = 20

export type BargeInCallback = (open: boolean) => void

export class BargeInDetector {
  private open = false
  private framesAbove = 0
  private framesBelow = 0
  private readonly refScratch: Float32Array

  constructor(
    private readonly frameSize: number,
    private readonly bus: RenderReferenceBus = getRenderReferenceBus(),
    private readonly onChange?: BargeInCallback
  ) {
    this.refScratch = new Float32Array(frameSize)
  }

  processFrame(micFrame: Float32Array): void {
    // No playback → barging in is not a meaningful state. Report closed
    // (default); main's gate treats absence-of-playback as "no suppression"
    // on its own. Reset debounce counters so the next playback starts
    // from a clean slate.
    if (!this.bus.isPlaybackActive()) {
      this.framesAbove = 0
      this.framesBelow = 0
      if (this.open) {
        this.open = false
        this.onChange?.(false)
      }
      return
    }

    const micEnergy = rms(micFrame)

    // Playback is active but mic is quiet → no speech.
    if (micEnergy < MIC_FLOOR) {
      this.tickBelow()
      return
    }

    this.bus.readMostRecent(this.frameSize, this.refScratch)
    const refEnergy = rms(this.refScratch)

    const speaking = micEnergy > refEnergy * MIC_OVER_REF_RATIO && micEnergy > MIC_FLOOR
    if (speaking) this.tickAbove()
    else this.tickBelow()
  }

  private tickAbove(): void {
    this.framesBelow = 0
    this.framesAbove++
    if (!this.open && this.framesAbove >= OPEN_FRAMES) {
      this.open = true
      this.onChange?.(true)
    }
  }

  private tickBelow(): void {
    this.framesAbove = 0
    this.framesBelow++
    if (this.open && this.framesBelow >= CLOSE_FRAMES) {
      this.open = false
      this.onChange?.(false)
    }
  }

  isOpen(): boolean {
    return this.open
  }
}
