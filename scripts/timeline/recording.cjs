/* eslint-disable @typescript-eslint/no-require-imports */
const { execFile } = require('node:child_process')
const { resolve } = require('node:path')
const { promisify } = require('node:util')

const run = promisify(execFile)

async function checkRecordingEncoder() {
  try {
    const { stdout } = await run('ffmpeg', ['-hide_banner', '-encoders'])
    if (!stdout.includes('libx264')) throw new Error('libx264 is unavailable')
  } catch (cause) {
    throw new Error(
      'Recording requires ffmpeg on PATH with its libx264 encoder installed.',
      { cause }
    )
  }
}

async function encodeRecording(source, destination) {
  // Argument arrays keep paths literal; no shell evaluates the output directory.
  // H.264/yuv420p and a leading MP4 index support direct browser playback.
  await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-i',
    resolve(source),
    '-map',
    '0:v:0',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-threads',
    '2',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    resolve(destination),
  ])
}

module.exports = { checkRecordingEncoder, encodeRecording }
