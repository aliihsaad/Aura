import os from 'node:os'
import type { LocalAiHardwareProfile } from '@shared/local-ai-types'

export function getLocalAiHardwareProfile(): LocalAiHardwareProfile {
  const totalMemoryGb = Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10
  const cpuModel = os.cpus()[0]?.model ?? 'Unknown CPU'
  const reasons: string[] = []
  let capabilityTier: LocalAiHardwareProfile['capabilityTier'] = 'low'

  if (totalMemoryGb >= 32) {
    capabilityTier = 'high'
  } else if (totalMemoryGb >= 16) {
    capabilityTier = 'balanced'
  } else {
    reasons.push('Less than 16GB system RAM')
  }

  return {
    platform: process.platform,
    arch: process.arch,
    totalMemoryGb,
    cpuModel,
    gpuSummary: 'GPU probe not run',
    capabilityTier,
    reasons,
  }
}
