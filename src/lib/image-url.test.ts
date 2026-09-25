import { describe, it, expect } from 'vitest'
import { isUsableImageUrl, firstSrcsetUrl, srcsetUrls, pickImageUrl } from '@/lib/image-url'

describe('isUsableImageUrl', () => {
  it('accepts a normal http address', () => {
    expect(isUsableImageUrl('https://example.com/a.jpg')).toBe(true)
  })

  it('accepts a relative path — resolving it is the caller’s job', () => {
    expect(isUsableImageUrl('/media/a.jpg')).toBe(true)
  })

  it('rejects the ZM-online lazy-loading placeholder', () => {
    expect(isUsableImageUrl('data:,')).toBe(false)
  })

  it('rejects any data URI, whatever follows the colon', () => {
    expect(isUsableImageUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(false)
    expect(isUsableImageUrl('data:image/gif;base64,R0lGOD')).toBe(false)
  })

  it('rejects a data URI written in mixed case or with leading whitespace', () => {
    expect(isUsableImageUrl('DATA:,')).toBe(false)
    expect(isUsableImageUrl('  data:,  ')).toBe(false)
  })

  // NEWS-20 BUG-2: the rule is an http(s) allowlist, not a `data:` blacklist.
  it('rejects every non-http(s) scheme, not just data:', () => {
    expect(isUsableImageUrl('javascript:alert(1)')).toBe(false)
    expect(isUsableImageUrl('JavaScript:alert(1)')).toBe(false)
    expect(isUsableImageUrl('about:blank')).toBe(false)
    expect(isUsableImageUrl('blob:https://example.com/abc')).toBe(false)
    expect(isUsableImageUrl('file:///etc/passwd')).toBe(false)
  })

  it('accepts http and https in any case, plus protocol-relative addresses', () => {
    expect(isUsableImageUrl('http://example.com/a.jpg')).toBe(true)
    expect(isUsableImageUrl('HTTPS://example.com/a.jpg')).toBe(true)
    expect(isUsableImageUrl('//cdn.example.com/a.jpg')).toBe(true)
  })

  it('rejects empty, whitespace-only, null and undefined values', () => {
    expect(isUsableImageUrl('')).toBe(false)
    expect(isUsableImageUrl('   ')).toBe(false)
    expect(isUsableImageUrl(null)).toBe(false)
    expect(isUsableImageUrl(undefined)).toBe(false)
  })
})

describe('firstSrcsetUrl', () => {
  it('takes the first candidate, not the highest resolution', () => {
    expect(firstSrcsetUrl('a.jpg 480w, b.jpg 800w')).toBe('a.jpg')
  })

  it('handles a single candidate without a descriptor', () => {
    expect(firstSrcsetUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
  })

  it('tolerates leading whitespace and newlines between candidates', () => {
    expect(firstSrcsetUrl('\n  a.jpg 1x,\n  b.jpg 2x')).toBe('a.jpg')
  })

  // NEWS-20 BUG-1: commas are legal inside a URL (Cloudinary/imgix transforms).
  it('keeps commas that sit inside a candidate URL', () => {
    expect(firstSrcsetUrl('https://cdn/a,b.jpg 1x, https://cdn/c.jpg 2x')).toBe(
      'https://cdn/a,b.jpg'
    )
    expect(firstSrcsetUrl('https://res.cloudinary.com/x/w_300,h_200/a.jpg 480w, b.jpg 800w')).toBe(
      'https://res.cloudinary.com/x/w_300,h_200/a.jpg'
    )
  })

  it('treats a trailing comma as a separator, not part of the URL', () => {
    expect(firstSrcsetUrl('a.jpg, b.jpg 2x')).toBe('a.jpg')
  })

  it('returns null for an empty or missing value', () => {
    expect(firstSrcsetUrl('')).toBeNull()
    expect(firstSrcsetUrl('   ')).toBeNull()
    expect(firstSrcsetUrl(null)).toBeNull()
    expect(firstSrcsetUrl(undefined)).toBeNull()
  })
})

describe('srcsetUrls', () => {
  it('lists every candidate in source order', () => {
    expect(srcsetUrls('a.jpg 480w, b.jpg 800w, c.jpg 1200w')).toEqual([
      'a.jpg',
      'b.jpg',
      'c.jpg',
    ])
  })

  it('does not split candidates on commas inside their URLs', () => {
    expect(srcsetUrls('https://cdn/w_1,h_2/a.jpg 1x, https://cdn/w_3,h_4/b.jpg 2x')).toEqual([
      'https://cdn/w_1,h_2/a.jpg',
      'https://cdn/w_3,h_4/b.jpg',
    ])
  })

  it('handles descriptor-less candidates separated by bare commas', () => {
    expect(srcsetUrls('a.jpg,b.jpg')).toEqual(['a.jpg,b.jpg'])
    expect(srcsetUrls('a.jpg, b.jpg')).toEqual(['a.jpg', 'b.jpg'])
  })

  it('returns an empty list for empty, whitespace-only or missing values', () => {
    expect(srcsetUrls('')).toEqual([])
    expect(srcsetUrls('   ')).toEqual([])
    expect(srcsetUrls(null)).toEqual([])
    expect(srcsetUrls(undefined)).toEqual([])
  })
})

describe('pickImageUrl', () => {
  it('uses src when it is a real address (regression guard for the working sources)', () => {
    expect(
      pickImageUrl({ src: 'https://example.com/a.jpg', dataSrc: 'https://example.com/b.jpg' })
    ).toBe('https://example.com/a.jpg')
  })

  it('falls through to data-src when src holds a data URI', () => {
    expect(pickImageUrl({ src: 'data:,', dataSrc: 'https://example.com/real.jpg' })).toBe(
      'https://example.com/real.jpg'
    )
  })

  it('falls through to data-lazy-src when data-src is missing', () => {
    expect(pickImageUrl({ src: 'data:,', dataLazySrc: 'https://example.com/lazy.jpg' })).toBe(
      'https://example.com/lazy.jpg'
    )
  })

  it('prefers data-src over data-lazy-src', () => {
    expect(
      pickImageUrl({
        src: 'data:,',
        dataSrc: 'https://example.com/a.jpg',
        dataLazySrc: 'https://example.com/b.jpg',
      })
    ).toBe('https://example.com/a.jpg')
  })

  it('skips a blank data-src and continues with data-lazy-src', () => {
    expect(
      pickImageUrl({ src: 'data:,', dataSrc: '   ', dataLazySrc: 'https://example.com/lazy.jpg' })
    ).toBe('https://example.com/lazy.jpg')
  })

  it('uses srcset as the last resort', () => {
    expect(
      pickImageUrl({
        src: 'data:,',
        dataSrc: '',
        dataLazySrc: null,
        srcset: 'https://example.com/small.jpg 480w, https://example.com/large.jpg 1200w',
      })
    ).toBe('https://example.com/small.jpg')
  })

  // NEWS-20 BUG-4: a placeholder in the first srcset slot must not hide the rest.
  it('skips a data: candidate inside srcset and takes the next real one', () => {
    expect(
      pickImageUrl({
        src: 'data:,',
        srcset: 'data:image/gif;base64,R0lGOD 1x, https://example.com/real.jpg 2x',
      })
    ).toBe('https://example.com/real.jpg')
  })

  it('keeps a comma-bearing srcset URL intact when it is the chosen one', () => {
    expect(
      pickImageUrl({ src: 'data:,', srcset: 'https://cdn/w_300,h_200/a.jpg 480w, b.jpg 800w' })
    ).toBe('https://cdn/w_300,h_200/a.jpg')
  })

  it('rejects a javascript: src and falls through to data-src', () => {
    expect(
      pickImageUrl({ src: 'javascript:alert(1)', dataSrc: 'https://example.com/real.jpg' })
    ).toBe('https://example.com/real.jpg')
  })

  it('returns null when none of the four attributes is usable', () => {
    expect(pickImageUrl({ src: 'data:,', dataSrc: '', dataLazySrc: null, srcset: '' })).toBeNull()
  })

  it('returns null when no attribute is present at all', () => {
    expect(pickImageUrl({})).toBeNull()
  })
})

describe('isUsableImageUrl — whitespace inside the scheme (NEWS-20 BUG-6)', () => {
  it('rejects a scheme split by a newline, tab or CR', () => {
    expect(isUsableImageUrl('java\nscript:alert(1)')).toBe(false)
    expect(isUsableImageUrl('java\tscript:alert(1)')).toBe(false)
    expect(isUsableImageUrl('java\rscript:alert(1)')).toBe(false)
    expect(isUsableImageUrl('da\nta:,')).toBe(false)
  })

  it('matches what the URL parser sees — it strips those characters too', () => {
    expect(new URL('java\nscript:alert(1)').protocol).toBe('javascript:')
  })

  it('still accepts an http(s) address that carries such characters', () => {
    expect(isUsableImageUrl('htt\nps://example.com/a.jpg')).toBe(true)
  })

  it('rejects a value that is only whitespace of that kind', () => {
    expect(isUsableImageUrl('\n\t\r')).toBe(false)
  })
})

describe('pickImageUrl — normalisation (NEWS-20 BUG-6)', () => {
  it('falls through a whitespace-obfuscated javascript: src', () => {
    expect(
      pickImageUrl({ src: 'java\nscript:alert(1)', dataSrc: 'https://example.com/real.jpg' })
    ).toBe('https://example.com/real.jpg')
  })

  it('stores the normalised form, not the raw attribute value', () => {
    expect(pickImageUrl({ src: 'https://example.com/\na.jpg' })).toBe('https://example.com/a.jpg')
  })
})

describe('isUsableImageUrl — leading C0 controls (NEWS-20 BUG-7)', () => {
  it('rejects a scheme hidden behind a leading C0 control', () => {
    expect(isUsableImageUrl('\u0000javascript:alert(1)')).toBe(false)
    expect(isUsableImageUrl('\u0001javascript:alert(1)')).toBe(false)
    expect(isUsableImageUrl('\u001Fjavascript:alert(1)')).toBe(false)
    expect(isUsableImageUrl('\u0000data:,')).toBe(false)
  })

  it('rejects the whole C0 range plus space, not just the whitespace subset', () => {
    for (let code = 0; code <= 0x20; code += 1) {
      const prefixed = String.fromCharCode(code) + 'data:,'
      expect(isUsableImageUrl(prefixed), `U+${code.toString(16)}`).toBe(false)
    }
  })

  it('matches what the URL parser sees — it strips those characters too', () => {
    expect(new URL('\u0001javascript:alert(1)').protocol).toBe('javascript:')
    expect(new URL('\u0000data:,').protocol).toBe('data:')
  })

  it('rejects a trailing control that would leave a rejected scheme behind', () => {
    expect(isUsableImageUrl('data:,\u0000')).toBe(false)
  })

  it('rejects a value made only of C0 controls', () => {
    expect(isUsableImageUrl('\u0000\u0001\u001F')).toBe(false)
  })

  it('still accepts an http(s) address wrapped in control characters', () => {
    expect(isUsableImageUrl('\u0001https://example.com/a.jpg\u0000')).toBe(true)
  })

  it('rejects a scheme obfuscated by a control character and inner whitespace', () => {
    expect(isUsableImageUrl('\u0001java\nscript:alert(1)')).toBe(false)
  })
})

describe('pickImageUrl — control-character normalisation (NEWS-20 BUG-7)', () => {
  it('falls through a control-prefixed placeholder to the real image', () => {
    expect(
      pickImageUrl({ src: '\u0000data:,', dataSrc: 'https://example.com/real.jpg' })
    ).toBe('https://example.com/real.jpg')
  })

  it('stores the stripped form, so new URL() cannot resurrect the raw value', () => {
    expect(pickImageUrl({ src: '\u0001https://example.com/a.jpg' })).toBe(
      'https://example.com/a.jpg'
    )
  })

  it('returns null when every candidate is a control-prefixed placeholder', () => {
    expect(
      pickImageUrl({ src: '\u0000data:,', dataSrc: '\u001Fjavascript:alert(1)' })
    ).toBeNull()
  })
})
