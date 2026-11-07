import { expect, test } from 'claude-code/testing'

import { createPackage, isGoPrivate, parseInstalls, parseRequirements, splitCommands, type Shell } from '../hooks/parse.ts'

/** `eco:name@version [source]` per spec, for compact assertions. */
function brief(command: string, shell: Shell = 'bash'): string[] {
  return parseInstalls(command, shell).specs.map(
    s => `${s.ecosystem}:${s.name}${s.version !== undefined ? `@${s.version}` : ''}${s.source === 'registry' ? '' : ` [${s.source}]`}`,
  )
}

test('npm, npx and their abbreviations', async () => {
  expect(brief('npm install lodash')).toEqual(['npm:lodash'])
  expect(brief('npm i -D typescript@5.4.2 @types/node@^20')).toEqual(['npm:typescript@5.4.2', 'npm:@types/node@^20'])
  expect(brief('npm add react react-dom --save-exact')).toEqual(['npm:react', 'npm:react-dom'])
  expect(brief('npm isntall left-pad')).toEqual(['npm:left-pad'])
  expect(brief('npm i -g --registry https://npm.example.com private-tool')).toEqual(['npm:private-tool [other-registry]'])
  expect(brief('npm i --registry=https://npm.example.com x')).toEqual(['npm:x [other-registry]'])
  expect(brief('npm install --prefix ./sub left-pad')).toEqual(['npm:left-pad'])
  expect(brief('npm i -w packages/app zod')).toEqual(['npm:zod'])
  expect(brief('npx create-react-app my-app')).toEqual(['npm:create-react-app'])
  expect(brief('npx -y cowsay hello')).toEqual(['npm:cowsay'])
  expect(brief('npx -p typescript -p ts-node tsc --version')).toEqual(['npm:typescript', 'npm:ts-node'])
  expect(brief('npx --package=@scope/tool@2 run-it')).toEqual(['npm:@scope/tool@2'])
  expect(brief('npm exec -- prettier --write .')).toEqual(['npm:prettier'])
  expect(brief('npm create vite@latest my-app -- --template react')).toEqual(['npm:create-vite@latest'])
  expect(brief('npm init @eslint/config')).toEqual(['npm:@eslint/create-config'])
  expect(brief('npm init -y')).toEqual([])
})

test('lockfile-only installs and unrelated npm commands find nothing', async () => {
  expect(brief('npm install')).toEqual([])
  expect(brief('npm ci')).toEqual([])
  expect(brief('npm i --no-audit')).toEqual([])
  expect(brief('bun install')).toEqual([])
  expect(brief('bun install --frozen-lockfile')).toEqual([])
  expect(brief('pnpm install')).toEqual([])
  expect(brief('yarn')).toEqual([])
  expect(brief('npm run build && npm test')).toEqual([])
  expect(brief('pip install -U pip --dry-run')).toEqual(['pypi:pip'])
  expect(brief('echo "npm install evil"')).toEqual([])
  expect(brief("git commit -m 'npm i foo'")).toEqual([])
})

test('bun, bunx, pnpm and yarn', async () => {
  expect(brief('bun add zod')).toEqual(['npm:zod'])
  expect(brief('bun add -d @types/bun')).toEqual(['npm:@types/bun'])
  expect(brief('bun i express@4.19.2')).toEqual(['npm:express@4.19.2'])
  expect(brief('bun a hono')).toEqual(['npm:hono'])
  expect(brief('bunx shadcn@latest add button')).toEqual(['npm:shadcn@latest'])
  expect(brief('bunx --bun vite')).toEqual(['npm:vite'])
  expect(brief('bun x cowsay hi')).toEqual(['npm:cowsay'])
  expect(brief('bun create next-app my-app')).toEqual(['npm:create-next-app'])
  expect(brief('pnpm add -D vitest')).toEqual(['npm:vitest'])
  expect(brief('pnpm --filter web add axios')).toEqual(['npm:axios'])
  expect(brief('pnpm dlx create-turbo')).toEqual(['npm:create-turbo'])
  expect(brief('yarn add lodash@^4.17.21')).toEqual(['npm:lodash@^4.17.21'])
  expect(brief('yarn global add nodemon')).toEqual(['npm:nodemon'])
  expect(brief('yarn dlx -p typescript tsc')).toEqual(['npm:typescript'])
})

test('npm spec forms: scopes, aliases, git, URLs and paths', async () => {
  expect(brief('npm i @babel/core@7.24.0')).toEqual(['npm:@babel/core@7.24.0'])
  expect(brief('npm i my-react@npm:react@18.2.0')).toEqual(['npm:react@18.2.0'])
  expect(brief('npm i github:user/repo')).toEqual(['npm:github:user/repo [git]'])
  expect(brief('npm i user/repo#main')).toEqual(['npm:user/repo#main [git]'])
  expect(brief('npm i git+https://github.com/u/r.git')).toEqual(['npm:git+https://github.com/u/r.git [git]'])
  expect(brief('npm i https://example.com/pkg-1.0.0.tgz')).toEqual(['npm:https://example.com/pkg-1.0.0.tgz [url]'])
  expect(brief('npm i ./local-pkg ../other file:../x pkg.tgz')).toEqual([
    'npm:./local-pkg [path]',
    'npm:../other [path]',
    'npm:file:../x [path]',
    'npm:pkg.tgz [path]',
  ])
  expect(brief('bun add jsr:@std/path')).toEqual(['npm:jsr:@std/path [other-registry]'])
  expect(brief('npm i foo@github:u/foo')).toEqual(['npm:foo [git]'])
  expect(brief('npm i foo@file:../foo')).toEqual(['npm:foo [path]'])
})

test('chains, pipes, subshells, wrappers and nested shells', async () => {
  expect(brief('cd app && npm i axios; pip install requests | tee log.txt')).toEqual(['npm:axios', 'pypi:requests'])
  expect(brief('npm i a || npm i b')).toEqual(['npm:a', 'npm:b'])
  expect(brief('(cd web && bun add zod) && echo done')).toEqual(['npm:zod'])
  expect(brief('echo $(npm i evil-sub)')).toEqual(['npm:evil-sub'])
  expect(brief('sudo -E npm i -g serve')).toEqual(['npm:serve'])
  expect(brief('NODE_ENV=dev FOO=1 npm i debug')).toEqual(['npm:debug'])
  expect(brief('env -u X CI=1 npm i ms')).toEqual(['npm:ms'])
  expect(brief('timeout 60 time nohup npm i chalk &')).toEqual(['npm:chalk'])
  expect(brief('bash -lc "npm i inner-pkg && pip install inner-py"')).toEqual(['npm:inner-pkg', 'pypi:inner-py'])
  expect(brief("sh -c 'cargo add serde'")).toEqual(['crates:serde'])
  expect(brief('npm i x > out.log 2>&1')).toEqual(['npm:x'])
  expect(brief('npm i x 2> err.txt')).toEqual(['npm:x'])
  expect(brief('npm i \\\n  express')).toEqual(['npm:express'])
  expect(brief('npm i a # npm i commented-out')).toEqual(['npm:a'])
  expect(brief('/usr/local/bin/npm i abs-path-npm')).toEqual(['npm:abs-path-npm'])
  expect(brief('cat <<EOF > notes.md\nnpm i not-really\nEOF\nnpm i really')).toEqual(['npm:really'])
  expect(brief("cat <<'END'\npip install nope\nEND")).toEqual([])
})

test('PowerShell syntax', async () => {
  expect(brief('npm i axios; pip install requests', 'powershell')).toEqual(['npm:axios', 'pypi:requests'])
  expect(brief("& 'C:\\Program Files\\nodejs\\npm.cmd' install left-pad", 'powershell')).toEqual(['npm:left-pad'])
  expect(brief('C:\\Python312\\python.exe -m pip install flask', 'powershell')).toEqual(['pypi:flask'])
  expect(brief('npm i x 2>&1 | Out-Null', 'powershell')).toEqual(['npm:x'])
  expect(brief('cd C:\\work\\app && bun add zod', 'powershell')).toEqual(['npm:zod'])
  expect(brief('npm i `\n  express', 'powershell')).toEqual(['npm:express'])
  expect(brief("Write-Output 'npm i nothing'", 'powershell')).toEqual([])
  expect(brief('powershell -NoProfile -Command "npm i inner"', 'bash')).toEqual(['npm:inner'])
  expect(brief('cmd /c npm i via-cmd', 'powershell')).toEqual(['npm:via-cmd'])
})

test('pip, python -m pip, uv, uvx and pipx', async () => {
  expect(brief('pip install requests')).toEqual(['pypi:requests'])
  // Unquoted, `>=2` is a shell redirect: pip gets plain `flask`, as a real shell would run it.
  expect(brief('pip3 install "requests[socks]==2.31.0" flask>=2')).toEqual(['pypi:requests@2.31.0', 'pypi:flask'])
  expect(brief('pip3 install "flask>=2"')).toEqual(['pypi:flask@>=2'])
  expect(brief('pip3.11 install --user Django~=4.2')).toEqual(['pypi:Django@~=4.2'])
  expect(brief('python -m pip install -U numpy')).toEqual(['pypi:numpy'])
  expect(brief('python3.12 -m pip install pandas==2.2.1')).toEqual(['pypi:pandas@2.2.1'])
  expect(brief('py -3 -m pip install rich')).toEqual(['pypi:rich'])
  expect(brief('pip --disable-pip-version-check install six')).toEqual(['pypi:six'])
  expect(brief('pip install -e . ')).toEqual(['pypi:. [path]'])
  expect(brief('pip install -e git+https://github.com/u/r.git#egg=r')).toEqual(['pypi:git+https://github.com/u/r.git#egg=r [git]'])
  expect(brief('pip install ./dist/pkg-1.0-py3-none-any.whl')).toEqual(['pypi:./dist/pkg-1.0-py3-none-any.whl [path]'])
  expect(brief('pip install mypkg @ https://example.com/mypkg.zip')).toEqual(['pypi:mypkg [url]'])
  expect(brief('pip install "mypkg @ git+https://github.com/u/r"')).toEqual(['pypi:mypkg [git]'])
  expect(brief('pip install -i https://pypi.example.com/simple internal-lib')).toEqual(['pypi:internal-lib [other-registry]'])
  expect(brief('pip install --target ./vendor -c constraints.txt attrs')).toEqual(['pypi:attrs'])
  expect(brief('uv pip install httpx')).toEqual(['pypi:httpx'])
  expect(brief('uv add "fastapi[standard]" --dev pytest')).toEqual(['pypi:fastapi', 'pypi:pytest'])
  expect(brief('uv add --group lint ruff')).toEqual(['pypi:ruff'])
  expect(brief('uv tool install --with requests httpie')).toEqual(['pypi:requests', 'pypi:httpie'])
  expect(brief('uvx --from black==24.1.0 black .')).toEqual(['pypi:black@24.1.0'])
  expect(brief('uvx ruff check .')).toEqual(['pypi:ruff'])
  expect(brief('pipx install poetry')).toEqual(['pypi:poetry'])
  expect(brief('pipx run cowsay moo')).toEqual(['pypi:cowsay'])
  expect(brief('python script.py install foo')).toEqual([])
  expect(brief('pip download requests')).toEqual([])
})

test('pip install -r: the file is handed over, and its text parses', async () => {
  const r = parseInstalls('pip install -r requirements.txt -r dev.txt', 'bash')
  expect(r.specs).toEqual([])
  expect(r.requirementFiles).toEqual(['requirements.txt', 'dev.txt'])
  expect(parseInstalls('pip install --requirement=req.txt', 'bash').requirementFiles).toEqual(['req.txt'])
  const text = [
    '# comment',
    'requests==2.31.0  # pinned',
    'flask>=2.0,<3',
    'numpy ; python_version >= "3.9"',
    '-r base.txt',
    '--index-url https://pypi.org/simple',
    '-e ./local',
    'git+https://github.com/u/r.git',
    'urllib3==2.0.7 \\',
    '    --hash=sha256:abc',
    '',
  ].join('\n')
  const parsed = parseRequirements(text)
  expect(parsed.nested).toEqual(['base.txt'])
  expect(parsed.specs.map(s => `${s.name}${s.version ? '@' + s.version : ''}:${s.source}`)).toEqual([
    'requests@2.31.0:registry',
    'flask@>=2.0,<3:registry',
    'numpy:registry',
    './local:path',
    'git+https://github.com/u/r.git:git',
    'urllib3@2.0.7:registry',
  ])
})

test('cargo, go, gem and composer', async () => {
  expect(brief('cargo add serde --features derive')).toEqual(['crates:serde'])
  expect(brief('cargo add tokio@1.37 serde_json')).toEqual(['crates:tokio@1.37', 'crates:serde_json'])
  expect(brief('cargo add -F full tokio')).toEqual(['crates:tokio'])
  expect(brief('cargo install ripgrep --version 14.1.0')).toEqual(['crates:ripgrep@14.1.0'])
  expect(brief('cargo +nightly install cargo-expand')).toEqual(['crates:cargo-expand'])
  expect(brief('cargo install --git https://github.com/u/tool tool')).toEqual(['crates:tool [git]'])
  expect(brief('cargo install --path .')).toEqual([])
  expect(brief('cargo add --registry corp internal')).toEqual(['crates:internal [other-registry]'])
  expect(brief('go get github.com/gin-gonic/gin@v1.9.1')).toEqual(['go:github.com/gin-gonic/gin@v1.9.1'])
  expect(brief('go install golang.org/x/tools/gopls@latest')).toEqual(['go:golang.org/x/tools/gopls@latest'])
  expect(brief('go get -u ./...')).toEqual(['go:./... [path]'])
  expect(brief('go get -tags integration example.com/mod')).toEqual(['go:example.com/mod'])
  expect(brief('go get github.com/x/y@none')).toEqual([])
  expect(brief('go get -u all')).toEqual([])
  expect(brief('go build ./...')).toEqual([])
  expect(brief('gem install rails -v 7.1.3')).toEqual(['rubygems:rails@7.1.3'])
  expect(brief('gem install nokogiri:1.16.0 --no-document')).toEqual(['rubygems:nokogiri@1.16.0'])
  expect(brief('gem install ./my.gem')).toEqual(['rubygems:./my.gem [path]'])
  expect(brief('gem install --source https://gems.example.com secret-gem')).toEqual(['rubygems:secret-gem [other-registry]'])
  expect(brief('composer require monolog/monolog')).toEqual(['packagist:monolog/monolog'])
  expect(brief('composer require --dev phpunit/phpunit:^10.5')).toEqual(['packagist:phpunit/phpunit@^10.5'])
  expect(brief('composer require "guzzlehttp/guzzle 7.8.*"')).toEqual(['packagist:guzzlehttp/guzzle@7.8.*'])
  expect(brief('composer require guzzlehttp/guzzle "7.8.*" php ext-json')).toEqual(['packagist:guzzlehttp/guzzle@7.8.*'])
  expect(brief('composer global require laravel/installer')).toEqual(['packagist:laravel/installer'])
})

test('duplicates fold, and odd inputs never throw', async () => {
  expect(brief('npm i zod && npm i zod')).toEqual(['npm:zod'])
  for (const weird of ['', ';;;', '"unterminated', "'also", '&&', '| npm', 'npm i "', 'npm i @', 'npm i @scope', '\\', '`', '$(', '<<']) {
    expect(Array.isArray(parseInstalls(weird, 'bash').specs)).toBe(true)
    expect(Array.isArray(parseInstalls(weird, 'powershell').specs)).toBe(true)
  }
  expect(brief('npm i @')).toEqual([])
  expect(brief('npm i @scope')).toEqual([])
})

test('splitting keeps quoted separators inside one word', async () => {
  expect(splitCommands('echo "a && b" ; ls', 'bash')).toEqual([['echo', 'a && b'], ['ls']])
  expect(splitCommands("echo 'it''s' ; ls", 'powershell')).toEqual([['echo', "it's"], ['ls']])
})

test('create-package names and Go private patterns', async () => {
  expect(createPackage('vite')).toBe('create-vite')
  expect(createPackage('vite@5')).toBe('create-vite@5')
  expect(createPackage('@scope')).toBe('@scope/create')
  expect(createPackage('@scope/app')).toBe('@scope/create-app')
  expect(isGoPrivate('github.com/acme/secret/sub', 'github.com/acme')).toBe(true)
  expect(isGoPrivate('github.com/acme/secret', '*.corp.example.com,github.com/acme/*')).toBe(true)
  expect(isGoPrivate('github.com/other/x', 'github.com/acme')).toBe(false)
  expect(isGoPrivate('git.corp.example.com/x', '*.corp.example.com')).toBe(true)
})

test('uv run --with installs packages, and they are checked', async () => {
  expect(brief('uv run --with requests python fetch.py')).toEqual(['pypi:requests'])
  expect(brief('uv run --with=pandas==2.2.0 --with rich --python 3.12 python -c "print(1)"')).toEqual(['pypi:pandas@2.2.0', 'pypi:rich'])
  expect(brief('uv run pytest --with notapkg')).toEqual([]) // after the command: its own arguments
  expect(parseInstalls('uv run --with-requirements reqs.txt python x.py', 'bash').requirementFiles).toEqual(['reqs.txt'])
})

test('a package word the parser cannot read is reported as unparsed, not dropped', async () => {
  const unparsed = (command: string, shell: Shell = 'bash') =>
    parseInstalls(command, shell).specs.filter(s => s.source === 'unparsed').map(s => `${s.ecosystem}:${s.raw}`)
  expect(unparsed('npm i $PKG')).toEqual(['npm:$PKG'])
  expect(unparsed('npm install ${NAME}@1.2.3')).toEqual(['npm:${NAME}@1.2.3'])
  expect(unparsed('npm i `cat pkgs.txt`')).toEqual(['npm:$(...)'])
  expect(unparsed('npm i $(cat pkgs.txt)')).toEqual(['npm:$(...)'])
  expect(unparsed('npm i "$(cat pkgs.txt)"')).toEqual(['npm:$(cat pkgs.txt)'])
  expect(unparsed("npm i $'lod\\x61sh'")).toEqual(['npm:lod\\x61sh'])
  expect(unparsed('npm i lod*')).toEqual(['npm:lod*'])
  expect(unparsed('bun add @scope/$X')).toEqual(['npm:@scope/$X'])
  expect(unparsed('npx $TOOL --help')).toEqual(['npm:$TOOL'])
  expect(unparsed('pip install requ*sts')).toEqual(['pypi:requ*sts'])
  expect(unparsed('uv add $DEP')).toEqual(['pypi:$DEP'])
  expect(unparsed('cargo add $CRATE')).toEqual(['crates:$CRATE'])
  expect(unparsed('go get $MOD')).toEqual(['go:$MOD'])
  expect(unparsed('gem install $GEM')).toEqual(['rubygems:$GEM'])
  expect(unparsed('composer require $VENDOR/pkg')).toEqual(['packagist:$VENDOR/pkg'])
  expect(unparsed('npm install $env:PKG', 'powershell')).toEqual(['npm:$env:PKG'])
  // flags and their values, and ordinary names, work as before
  expect(brief('npm i --prefix $(pwd) --registry=$REG_URL -D lodash')).toEqual(['npm:lodash [other-registry]'])
  expect(brief('npm i -D typescript@5.4.2 @types/node@^20 lodash@*')).toEqual(['npm:typescript@5.4.2', 'npm:@types/node@^20', 'npm:lodash@*'])
  expect(brief('pip install "requests[socks]>=2.31" django==4.*')).toEqual(['pypi:requests@>=2.31', 'pypi:django@==4.*'])
  expect(brief('composer require monolog/monolog 2.*')).toEqual(['packagist:monolog/monolog@2.*'])
  expect(brief('echo $(date) && npm i left-pad')).toEqual(['npm:left-pad'])
  // deliberate evasion is out of scope (see README)
  expect(brief('echo lodash | xargs npm i')).toEqual([])
})
