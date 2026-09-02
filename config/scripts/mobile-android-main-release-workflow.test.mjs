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

  it('keeps public tag and manual release updates compatible', () => {
    expect(workflow.concurrency['cancel-in-progress']).toBe(
      "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}"
    )
    const ensureTag = stepNamed('Ensure GitHub release tag').run
    expect(ensureTag).toContain('remote_target=')
    expect(ensureTag).toContain("awk 'NR == 1 { print $1 }'")
    expect(ensureTag).toContain('git tag --force "$tag" "$GITHUB_SHA"')
    expect(ensureTag).toContain('--force-with-lease=')
    expect(ensureTag).toContain('refs/tags/$tag:$remote_target')
  })

  it('uses a versioned APK only for private main releases', () => {
    const apk = stepNamed('Name release APK')
    const apkName =
      'orca-mobile-${{ steps.release.outputs.version }}-build${{ steps.release.outputs.android_version_code }}-${short_sha}-run${GITHUB_RUN_ID}-attempt${GITHUB_RUN_ATTEMPT}.apk'

    expect(apk?.id).toBe('apk')
    expect(apk?.env?.PRIVATE_MAIN_RELEASE).toBe(
      "${{ github.event_name == 'push' && github.repository == 'kargnas/orca' && github.ref == 'refs/heads/main' }}"
    )
    expect(apk?.run).toContain('if [[ "$PRIVATE_MAIN_RELEASE" == "true" ]]')
    expect(apk?.run).toContain('app-release.apk')
    expect(apk?.run).toContain('short_sha="${GITHUB_SHA:0:7}"')
    expect(apk?.run).toContain('GITHUB_RUN_ID')
    expect(apk?.run).toContain('sha256sum "$apk_name" > "$apk_name.sha256"')
    expect(apk?.run).toContain('echo "checksum_path=$checksum_path"')
    expect(apk?.run).toContain(apkName)
  })

  it('pins private main releases to the exact source and never overwrites immutable assets', () => {
    const checkout = stepNamed('Checkout')
    const ensureTag = stepNamed('Ensure GitHub release tag')
    const release = stepNamed('Create GitHub Release')

    expect(checkout?.with?.ref).toBe('${{ github.sha }}')
    expect(ensureTag?.run).toContain('tag="${{ steps.release.outputs.tag }}"')
    expect(ensureTag?.run).toContain('git tag "$tag" "$GITHUB_SHA"')
    expect(ensureTag?.run).toContain('remote_target')
    expect(ensureTag?.run).toContain('git tag --force "$tag" "$GITHUB_SHA"')
    expect(ensureTag?.run).toContain('git push origin "refs/tags/$tag"')
    expect(release?.env?.PRIVATE_MAIN_RELEASE).toBe(
      "${{ github.event_name == 'push' && github.repository == 'kargnas/orca' && github.ref == 'refs/heads/main' }}"
    )
    expect(release?.run).toContain('if [[ "$PRIVATE_MAIN_RELEASE" == "true" ]]')
    expect(release?.run).toContain('--target "$GITHUB_SHA"')
    const privateReleaseSection = release?.run.split('elif gh release view')[0] ?? ''
    expect(privateReleaseSection).not.toContain('--clobber')
    expect(privateReleaseSection).toContain('"$apk_path" "$checksum_path"')
    expect(release?.run).toContain('gh release upload "$tag"')
    expect(release?.run).toContain('--clobber')
  })

  it('keeps the generic APK filename for public tag and manual releases', () => {
    const apk = stepNamed('Name release APK')
    const upload = stepNamed('Upload APK artifact')
    const release = stepNamed('Create GitHub Release')

    expect(apk?.run).toContain('apk_path="android/app/build/outputs/apk/release/app-release.apk"')
    expect(upload?.with?.path).toBe('mobile/${{ steps.apk.outputs.path }}')
    expect(release?.run).toContain('${{ steps.apk.outputs.path }}')
  })
})
