"""静态模拟本插件条件/替换；不等同于 Loon 真机网络测试。仅用 Python 标准库。"""
import json
import re
import unittest
from pathlib import Path

PLUGIN = Path(__file__).with_name('nodeseek-jump.lpx')


def regex_value(raw):
    match = re.fullmatch(r'/(.*)/([i]*)', raw.strip())
    if not match:
        raise AssertionError('未知正则语法: ' + raw)
    return re.compile(match[1].replace(r'\/', '/'), re.I if match[2] else 0)


def redirect(url, headers=None, method='GET'):
    headers = {k.lower(): v for k, v in (headers or {}).items()}
    for line in PLUGIN.read_text().splitlines():
        if not line.startswith('request if '):
            continue
        condition, action = line[len('request if '):].split(' then ')
        match = re.fullmatch(r'\$\{url\} ~= (/.*/i?) as (\w+)(.*)', condition)
        if not match:
            raise AssertionError('未知条件语法: ' + condition)
        pattern, capture, guard = match.groups()
        found = regex_value(pattern).search(url)
        if not found:
            continue
        if guard:
            parts = re.fullmatch(
                r' && \$\{request.method\} == "GET" && '
                r'\(\$\{request.header\[\'Referer\'\]\} == null \|\| '
                r'\$\{request.header\[\'Referer\'\]\} ~= (/.*/i?)\)', guard)
            if not parts:
                raise AssertionError('未知保护条件: ' + guard)
            referer = headers.get('referer')
            if method != 'GET' or (referer is not None and not regex_value(parts[1]).search(referer)):
                continue
        output = re.fullmatch(r'redirect\(302, (".*")\)', action)
        if not output:
            raise AssertionError('未知动作: ' + action)
        target = json.loads(output[1])
        return re.sub(r'\$\{' + capture + r'\.(\d+)\}',
                      lambda m: found[int(m[1])] or '', target)
    return None


class RewriteTests(unittest.TestCase):
    def test_external_links(self):
        for ref in [None, '', 'https://t.me/nodeseek', 'https://www.google.com/',
                    'https://nodeseek.com.example.org/']:
            with self.subTest(referer=ref):
                headers = {} if ref is None else {'Referer': ref}
                self.assertEqual(redirect('https://www.nodeseek.com/post-1081237-1', headers),
                                 'nsconnect://post/1081237-1')

    def test_native_body_requests_are_not_redirected(self):
        for ref in ['https://www.nodeseek.com/', 'https://nodeseek.com/',
                    'https://www.nodeseek.com/post-1081237-1',
                    'https://www.nodeseek.com', 'https://sub.nodeseek.com/',
                    'HTTPS://WWW.NODESEEK.COM:443/']:
            with self.subTest(referer=ref):
                self.assertIsNone(redirect('https://www.nodeseek.com/post-1081237-1', {'referer': ref}))
                self.assertIsNone(redirect('https://nodeseek.com/post-1081237', {'referer': ref}))

    def test_pages_queries_case(self):
        for source, target in [
            ('http://nodeseek.com/post-1081237', '1081237'),
            ('https://www.nodeseek.com/post-1081237-3/?foo=bar&x=1', '1081237-3'),
            ('https://NODESEEK.COM/post-1081237?x=1', '1081237'),
        ]:
            self.assertEqual(redirect(source), 'nsconnect://post/' + target)

    def test_unrelated_urls_and_non_get_are_untouched(self):
        for url in ['https://evil.example/post-1', 'https://www.nodeseek.com/post-abc',
                    'https://nodeseek.com/post-1-2/extra', 'https://nodeseek.com/api/post-1',
                    'https://nodeseek.com/post-1-2-3']:
            self.assertIsNone(redirect(url))
        self.assertIsNone(redirect('https://nodeseek.com/post-1081237-1', method='POST'))


if __name__ == '__main__':
    unittest.main()
