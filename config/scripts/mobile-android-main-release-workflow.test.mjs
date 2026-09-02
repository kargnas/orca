import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflow = parse(
  readFileSync(join(projectDir, '.github/workflows/mobile-android-release.yml'), 'utf8')
)
const triggers = workflow.on ?? workflow[true]
const androidJob = workflow.jobs['android-build']
const stepNamed = (name) => androidJob.steps.find((step) => step.name === name)

describe('mobile Android main release workflow', () => {
  it('runs for mobile changes pushed to main without changing tag releases', () => {
    expect(triggers.push.branches).toEqual(['main'])
    expect(triggers.push.paths).toEqual([
      'mobile/**',
      '.github/workflows/mobile-android-release.yml'
    ])
    expect(triggers.push.tags).toEqual(['mobile-android-v*'])
  })

  it('publishes automatic main builds only from the private fork', () => {
    expect(androidJob.if).toContain("github.repository == 'kargnas/orca'")
    expect(stepNamed('Resolve release version and version code').env).toHaveProperty(
      'MOBILE_ANDROID_PUBLISH_RELEASE',
      "${{ (github.event_name == 'push' && github.ref == 'refs/heads/main') || github.event.inputs.publish_github_release }}"
    )
  })

  it('frees unused runner storage before installing Android build dependencies', () => {
    const cleanupIndex = androidJob.steps.findIndex(
      (step) => step.name === 'Free runner disk space'
    )
    const installIndex = androidJob.steps.findIndex((step) => step.name === 'Install dependencies')
    const cleanup = stepNamed('Free runner disk space')?.run ?? ''

    expect(cleanupIndex).toBeGreaterThan(-1)
    expect(cleanupIndex).toBeLessThan(installIndex)
    expect(cleanup).toContain('/usr/share/dotnet')
    expect(cleanup).toContain('/system-images')
    expect(cleanup).toContain('/emulator')
    expect(cleanup).not.toMatch(/\/ndk|\/cmake|\/platforms|\/build-tools/)
  })

  it('keeps the newest main APK and release tag when pushes overlap', () => {
    expect(workflow.concurrency['cancel-in-progress']).toBe(
      "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}"
    )
    const ensureTag = stepNamed('Ensure GitHub release tag').run
    expect(ensureTag).toContain('remote_target=')
    expect(ensureTag).toContain("awk 'NR == 1 { print $1 }'")
    expect(ensureTag).toContain('--force-with-lease=')
    expect(ensureTag).toContain('refs/tags/$tag:$remote_target')
  })

  it('publishes a versioned APK filename instead of the generic Gradle filename', () => {
    const rename = stepNamed('Name release APK')
    const upload = stepNamed('Upload APK artifact')
    const release = stepNamed('Create GitHub Release')
    const apkName =
      'orca-mobile-${{ steps.release.outputs.version }}-build${{ steps.release.outputs.android_version_code }}.apk'

    expect(rename?.env?.APK_NAME).toBe(apkName)
    expect(rename?.run).toContain('mv')
    expect(upload?.with?.path).toBe(`mobile/android/app/build/outputs/apk/release/${apkName}`)
    expect(release?.run).toContain(`android/app/build/outputs/apk/release/${apkName}`)
    expect(upload?.with?.path).not.toContain('app-release')
    expect(release?.run).not.toContain('app-release*.apk')
  })
})
