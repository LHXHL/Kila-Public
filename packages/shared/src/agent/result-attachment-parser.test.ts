import { describe, expect, test } from 'bun:test'
import { extractKilaImageAttachments } from './result-attachment-parser'

describe('extractKilaImageAttachments', () => {
  test('strips image markers from text and returns structured attachments', () => {
    const result = extractKilaImageAttachments(
      `generated image [KILA_IMAGE_ATTACHMENT:${JSON.stringify({
        localPath: '/tmp/image.png',
        filename: 'image.png',
        mediaType: 'image/png',
      })}]`,
    )

    expect(result).toEqual({
      cleanedText: 'generated image',
      images: [
        {
          localPath: '/tmp/image.png',
          filename: 'image.png',
          mediaType: 'image/png',
        },
      ],
    })
  })

  test('keeps plain text untouched when no marker exists', () => {
    expect(extractKilaImageAttachments('plain text result')).toEqual({
      cleanedText: 'plain text result',
      images: [],
    })
  })
})
