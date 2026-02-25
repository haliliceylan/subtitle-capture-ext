/**
 * Test suite for mpv command generation
 * Run with: node test-mpv-command.js
 */

import { buildMpvCommand } from './modules/commands.js';

// Simple test runner
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

console.log('=== MPV Command Generation Tests ===\n');

// Test Case 1: Full command with all options (the user's specific case)
test('generates command with all options (megacloud example)', () => {
  const streamItem = {
    url: 'https://haildrop77.pro/_v7/a6eb4ec00ec0892c91a0d4d52044cae20b1b17cabb0ef2e9c8dbb31e29740b390ed4d12d455f048f4f18134451744389527d0d38ca8d3788a55af4a91fbd0a9d5f1a8f3337139b25ec403fee0d7e5354dbdc891c64bb7172fcb5f10d5b622443007ec894211ef88883bdcb91e23441fe4c1459854180991c4a3b1e305132ffb0/index-f1-v1-a1.m3u8',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Referer': 'https://megacloud.blog/',
      'Origin': 'https://megacloud.blog'
    }
  };

  const subtitleItems = [
    { url: 'https://mgstatics.xyz/subtitle/4603f7d51a928b39df2bf8145b97ab9a/4603f7d51a928b39df2bf8145b97ab9a.vtt' }
  ];

  const cmd = buildMpvCommand(streamItem, subtitleItems);

  // Verify key components
  assert(cmd.includes('mpv \\\n'), 'Should start with mpv');
  assert(cmd.includes('--force-window=immediate'), 'Should have force-window');
  assert(cmd.includes('--sub-auto=fuzzy'), 'Should have sub-auto');
  assert(cmd.includes('--demuxer-lavf-o=allowed_extensions=ALL'), 'Should have demuxer option');
  assert(cmd.includes('--sub-file="https://mgstatics.xyz/subtitle/'), 'Should have subtitle file with double quotes');
  assert(cmd.includes('--user-agent="Mozilla/5.0'), 'Should have user-agent with double quotes');
  assert(cmd.includes('--http-header-fields="Accept: */*,Referer: https://megacloud.blog/,Origin: https://megacloud.blog"'), 
    'Should have http-header-fields with comma-separated values');
  assert(cmd.includes('--msg-level=ffmpeg=trace,demuxer=trace,network=trace'), 'Should have msg-level');
  assert(cmd.includes('--log-file=mpv-trace.log'), 'Should have log-file');
  assert(cmd.trim().endsWith('"https://haildrop77.pro/_v7/a6eb4ec00ec0892c91a0d4d52044cae20b1b17cabb0ef2e9c8dbb31e29740b390ed4d12d455f048f4f18134451744389527d0d38ca8d3788a55af4a91fbd0a9d5f1a8f3337139b25ec403fee0d7e5354dbdc891c64bb7172fcb5f10d5b622443007ec894211ef88883bdcb91e23441fe4c1459854180991c4a3b1e305132ffb0/index-f1-v1-a1.m3u8"'), 'Should end with stream URL in double quotes');
  
  // Verify old format is NOT used
  assert(!cmd.includes('--stream-lavf-o'), 'Should NOT use old stream-lavf-o format');
  assert(!cmd.includes("$'"), 'Should NOT use ANSI-C quoting');
  assert(!cmd.includes('\\r\\n'), 'Should NOT use CRLF separators');
});

// Test Case 2: Command without subtitles
test('generates command without subtitles', () => {
  const streamItem = {
    url: 'https://example.com/stream.m3u8',
    headers: {
      'Referer': 'https://example.com/'
    }
  };

  const cmd = buildMpvCommand(streamItem, []);

  assert(cmd.includes('mpv \\\n'), 'Should start with mpv');
  assert(!cmd.includes('--sub-file'), 'Should NOT have sub-file without subtitles');
  assert(cmd.includes('--http-header-fields="Referer: https://example.com/"'), 'Should have referer header');
  assert(cmd.endsWith('"https://example.com/stream.m3u8"'), 'Should end with stream URL');
});

// Test Case 3: Command without headers
test('generates command without headers', () => {
  const streamItem = {
    url: 'https://example.com/stream.m3u8'
  };

  const cmd = buildMpvCommand(streamItem, []);

  assert(cmd.includes('mpv \\\n'), 'Should start with mpv');
  assert(!cmd.includes('--http-header-fields'), 'Should NOT have header fields without headers');
  assert(!cmd.includes('--user-agent'), 'Should NOT have user-agent without headers');
  assert(cmd.endsWith('"https://example.com/stream.m3u8"'), 'Should end with stream URL');
});

// Test Case 4: Command with multiple subtitles
test('generates command with multiple subtitles', () => {
  const streamItem = {
    url: 'https://example.com/stream.m3u8',
    headers: {}
  };

  const subtitleItems = [
    { url: 'https://example.com/sub1.vtt' },
    { url: 'https://example.com/sub2.vtt' },
    { url: 'https://example.com/sub3.vtt' }
  ];

  const cmd = buildMpvCommand(streamItem, subtitleItems);

  const subFileCount = (cmd.match(/--sub-file=/g) || []).length;
  assert(subFileCount === 3, `Should have 3 subtitle files, got ${subFileCount}`);
  assert(cmd.includes('--sub-file="https://example.com/sub1.vtt"'), 'Should have first subtitle');
  assert(cmd.includes('--sub-file="https://example.com/sub2.vtt"'), 'Should have second subtitle');
  assert(cmd.includes('--sub-file="https://example.com/sub3.vtt"'), 'Should have third subtitle');
});

// Test Case 5: Empty stream URL returns empty string
test('returns empty string for empty stream URL', () => {
  const cmd = buildMpvCommand({ url: '' }, []);
  assert(cmd === '', 'Should return empty string for empty URL');
});

// Test Case 6: Verify double quotes are used (not single quotes)
test('uses double quotes for all string values', () => {
  const streamItem = {
    url: 'https://example.com/stream.m3u8',
    headers: {
      'User-Agent': 'TestAgent/1.0',
      'Referer': 'https://referer.com/'
    }
  };

  const subtitleItems = [{ url: 'https://example.com/sub.vtt' }];
  const cmd = buildMpvCommand(streamItem, subtitleItems);

  // Check that double quotes are used
  assert(cmd.includes('--sub-file="https://example.com/sub.vtt"'), 'Subtitle should use double quotes');
  assert(cmd.includes('--user-agent="TestAgent/1.0"'), 'User-agent should use double quotes');
  assert(cmd.endsWith('"https://example.com/stream.m3u8"'), 'URL should use double quotes');
  
  // Check that single quotes are NOT used for these values
  assert(!cmd.includes("--sub-file='"), 'Subtitle should NOT use single quotes');
  assert(!cmd.includes("--user-agent='"), 'User-agent should NOT use single quotes');
  assert(!cmd.endsWith("'"), 'URL should NOT end with single quote');
});

// Print summary
console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

// Optional: Print the full command for the main test case
console.log('\n=== Generated Command (Test Case 1) ===\n');
const mainTestStream = {
  url: 'https://haildrop77.pro/_v7/a6eb4ec00ec0892c91a0d4d52044cae20b1b17cabb0ef2e9c8dbb31e29740b390ed4d12d455f048f4f18134451744389527d0d38ca8d3788a55af4a91fbd0a9d5f1a8f3337139b25ec403fee0d7e5354dbdc891c64bb7172fcb5f10d5b622443007ec894211ef88883bdcb91e23441fe4c1459854180991c4a3b1e305132ffb0/index-f1-v1-a1.m3u8',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://megacloud.blog/',
    'Origin': 'https://megacloud.blog'
  }
};
const mainTestSubs = [{ url: 'https://mgstatics.xyz/subtitle/4603f7d51a928b39df2bf8145b97ab9a/4603f7d51a928b39df2bf8145b97ab9a.vtt' }];
console.log(buildMpvCommand(mainTestStream, mainTestSubs));
