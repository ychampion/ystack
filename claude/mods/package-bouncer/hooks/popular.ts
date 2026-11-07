// Small lists of widely used packages per registry, for spotting look-alike (typosquat) names.
// A name is suspect when it is one or two edits away from one of these and is not itself on the list.

import { normalizePypi, type Ecosystem } from './parse.ts'

const NPM = `
react react-dom vue angular svelte next nuxt vite webpack rollup esbuild parcel typescript babel-core @babel/core
@babel/preset-env @babel/preset-react @babel/runtime @types/node @types/react @types/react-dom @types/express
@types/jest lodash lodash-es underscore ramda axios node-fetch got superagent request express koa fastify hapi
@nestjs/core @nestjs/common body-parser cors helmet morgan cookie-parser express-session multer dotenv cross-env
commander yargs minimist chalk kleur picocolors colors debug winston pino bunyan uuid nanoid moment dayjs date-fns
luxon classnames clsx prop-types redux react-redux @reduxjs/toolkit mobx zustand jotai recoil immer rxjs
react-router react-router-dom @tanstack/react-query swr formik react-hook-form yup zod joi ajv
styled-components @emotion/react @emotion/styled tailwindcss postcss autoprefixer sass less
jest mocha chai sinon vitest @testing-library/react @testing-library/jest-dom cypress playwright puppeteer
eslint prettier eslint-plugin-react eslint-config-prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin
nodemon ts-node tsx concurrently rimraf mkdirp glob fast-glob minimatch chokidar fs-extra graceful-fs semver
inquirer ora prompts execa shelljs cross-spawn which async bluebird p-limit p-queue mongoose mongodb mysql mysql2
pg sequelize typeorm prisma @prisma/client knex redis ioredis sqlite3 better-sqlite3 socket.io socket.io-client
ws graphql apollo-server @apollo/client jsonwebtoken bcrypt bcryptjs passport crypto-js qs cheerio jsdom
marked markdown-it highlight.js handlebars ejs pug mustache sharp jimp canvas three d3 chart.js echarts
electron electron-builder firebase aws-sdk @aws-sdk/client-s3 stripe openai @anthropic-ai/sdk langchain
nodemailer xml2js js-yaml yaml ini csv-parse papaparse xlsx archiver tar adm-zip form-data busboy mime mime-types
path-to-regexp http-proxy-middleware compression serve-static iconv-lite buffer events util core-js regenerator-runtime
tslib zone.js @angular/core @angular/common @angular/cli @vue/cli vue-router pinia vuex nuxt3 gatsby remix
@remix-run/react astro solid-js preact lit alpinejs jquery bootstrap @mui/material @mui/icons-material antd
@chakra-ui/react framer-motion lucide-react react-icons @radix-ui/react-dialog shadcn-ui storybook @storybook/react
husky lint-staged commitlint semantic-release lerna nx turbo verdaccio pm2 forever serve http-server live-server
`

const PYPI = `
requests urllib3 certifi charset-normalizer idna six python-dateutil pytz setuptools wheel pip packaging
numpy pandas scipy matplotlib seaborn plotly scikit-learn scikit-image statsmodels sympy networkx
tensorflow keras torch torchvision torchaudio transformers tokenizers datasets accelerate huggingface-hub safetensors
sentencepiece onnx onnxruntime xgboost lightgbm catboost opencv-python pillow imageio jax jaxlib
flask django fastapi starlette uvicorn gunicorn werkzeug jinja2 markupsafe itsdangerous click typer rich
pydantic pydantic-core attrs dataclasses-json marshmallow sqlalchemy alembic psycopg2 psycopg2-binary psycopg
pymysql mysqlclient pymongo redis celery kombu boto3 botocore s3transfer awscli google-cloud-storage
google-api-python-client google-auth azure-storage-blob azure-identity openai anthropic langchain langchain-core
llama-index tiktoken httpx httpcore aiohttp anyio sniffio h11 websockets websocket-client grpcio protobuf
pyyaml toml tomli tomlkit ujson orjson simplejson lxml beautifulsoup4 html5lib soupsieve selenium playwright
scrapy pytest pytest-cov pytest-mock pytest-asyncio coverage tox nox mock hypothesis black isort flake8
pylint mypy ruff autopep8 yapf pre-commit virtualenv pipenv poetry poetry-core hatchling build twine
cryptography pyopenssl cffi pycparser bcrypt paramiko pyjwt passlib oauthlib requests-oauthlib python-jose
tqdm colorama termcolor tabulate prettytable loguru python-dotenv decorator wrapt cachetools filelock
platformdirs appdirs psutil pexpect ptyprocess docker kubernetes ansible fabric invoke jsonschema
jmespath regex chardet markdown docutils sphinx mkdocs mkdocs-material nltk spacy gensim textblob
streamlit gradio dash bokeh jupyter notebook ipython ipykernel jupyterlab nbformat nbconvert
openpyxl xlrd xlsxwriter pyarrow polars dask numba cython pybind11 joblib cloudpickle sentry-sdk
prometheus-client opentelemetry-api pyserial pyusb pygame kivy pyqt5 pyside6 tornado twisted gevent eventlet
greenlet msgpack zipp importlib-metadata typing-extensions more-itertools pluggy iniconfig exceptiongroup
`

const CRATES = `
serde serde_json serde_derive serde_yaml toml tokio tokio-util futures futures-util async-trait async-std
anyhow thiserror eyre color-eyre log env_logger tracing tracing-subscriber clap structopt rand rand_core
regex lazy_static once_cell itertools chrono time uuid reqwest hyper http axum actix-web actix-rt warp rocket
tower tower-http tonic prost bytes byteorder bitflags libc winapi windows windows-sys nix cfg-if memchr
smallvec parking_lot crossbeam crossbeam-channel rayon num num-traits num-bigint indexmap hashbrown ahash
base64 hex sha2 sha1 md-5 digest hmac ring rustls openssl native-tls webpki tokio-rustls url percent-encoding
mime walkdir glob tempfile dirs directories notify flate2 zip tar csv quick-xml xml-rs image
diesel sqlx rusqlite postgres redis mongodb sea-orm syn quote proc-macro2 darling paste
strum strum_macros derive_more getrandom semver dashmap arc-swap pin-project pin-project-lite
futures-core futures-channel mio socket2 tungstenite tokio-tungstenite wasm-bindgen js-sys web-sys
console indicatif dialoguer colored termcolor crossterm ratatui tui ansi_term atty is-terminal
criterion proptest quickcheck mockall insta pretty_assertions assert_cmd predicates
bincode postcard rmp-serde ciborium prost-types protobuf capnp flatbuffers
humantime humantime-serde unicode-width unicode-segmentation encoding_rs aho-corasick bstr
tokio-stream async-stream which shellexpand dotenvy dotenv config figment
jsonwebtoken argon2 bcrypt aes chacha20poly1305 ed25519-dalek x25519-dalek curve25519-dalek
`

const RUBYGEMS = `
rails rack rake bundler activesupport activerecord actionpack actionview activemodel railties actionmailer
activejob actioncable activestorage puma unicorn thin sinatra rspec rspec-core rspec-rails minitest
capybara selenium-webdriver factory_bot factory_bot_rails faker rubocop rubocop-rails rubocop-rspec
pry pry-byebug byebug debug irb json nokogiri httparty faraday rest-client net-http excon typhoeus
devise omniauth cancancan pundit jwt bcrypt sidekiq resque delayed_job redis pg mysql2 sqlite3
sequel mongoid kaminari will_paginate pagy carrierwave paperclip shrine image_processing mini_magick
aws-sdk aws-sdk-s3 fog-aws stripe sass sassc sprockets webpacker jsbundling-rails cssbundling-rails
turbo-rails stimulus-rails importmap-rails propshaft haml slim erubi tilt mustermann builder
thor dotenv dotenv-rails figaro bootsnap listen spring tzinfo i18n concurrent-ruby zeitwerk
mail mime-types rack-cors rack-attack oj multi_json yajl-ruby msgpack ffi racc rexml
simplecov webmock vcr timecop database_cleaner shoulda-matchers guard guard-rspec
whenever rufus-scheduler clockwork god foreman capistrano mina chef puppet vagrant fastlane
cocoapods jekyll middleman nanoc octokit graphql graphql-ruby grape rabl jbuilder active_model_serializers
fast_jsonapi blueprinter dry-types dry-validation dry-struct hanami rom-rb roda
colorize paint tty-prompt highline commander gli optimist slop awesome_print
`

const GO = `
github.com/gin-gonic/gin github.com/gorilla/mux github.com/labstack/echo/v4 github.com/gofiber/fiber/v2
github.com/go-chi/chi/v5 github.com/julienschmidt/httprouter github.com/spf13/cobra github.com/spf13/viper
github.com/spf13/pflag github.com/urfave/cli/v2 github.com/sirupsen/logrus go.uber.org/zap github.com/rs/zerolog
github.com/stretchr/testify github.com/onsi/ginkgo/v2 github.com/onsi/gomega github.com/golang/mock
go.uber.org/mock github.com/google/uuid github.com/gofrs/uuid github.com/pkg/errors github.com/hashicorp/go-multierror
github.com/golang-jwt/jwt/v5 github.com/dgrijalva/jwt-go golang.org/x/crypto golang.org/x/net golang.org/x/sys
golang.org/x/text golang.org/x/sync golang.org/x/oauth2 golang.org/x/tools golang.org/x/exp golang.org/x/mod
google.golang.org/grpc google.golang.org/protobuf github.com/golang/protobuf github.com/grpc-ecosystem/grpc-gateway/v2
gorm.io/gorm gorm.io/driver/postgres gorm.io/driver/mysql github.com/jmoiron/sqlx github.com/lib/pq
github.com/jackc/pgx/v5 github.com/go-sql-driver/mysql github.com/mattn/go-sqlite3 go.mongodb.org/mongo-driver
github.com/redis/go-redis/v9 github.com/go-redis/redis/v8 github.com/gomodule/redigo github.com/nats-io/nats.go
github.com/segmentio/kafka-go github.com/IBM/sarama github.com/Shopify/sarama github.com/streadway/amqp
github.com/rabbitmq/amqp091-go github.com/aws/aws-sdk-go github.com/aws/aws-sdk-go-v2 cloud.google.com/go
github.com/prometheus/client_golang go.opentelemetry.io/otel github.com/opentracing/opentracing-go
github.com/gorilla/websocket nhooyr.io/websocket github.com/valyala/fasthttp github.com/go-resty/resty/v2
github.com/go-playground/validator/v10 github.com/mitchellh/mapstructure github.com/fatih/color
github.com/charmbracelet/bubbletea github.com/charmbracelet/lipgloss github.com/manifoldco/promptui
github.com/joho/godotenv github.com/kelseyhightower/envconfig github.com/BurntSushi/toml gopkg.in/yaml.v3
gopkg.in/yaml.v2 github.com/goccy/go-json github.com/json-iterator/go github.com/tidwall/gjson
github.com/hashicorp/consul/api github.com/hashicorp/vault/api github.com/docker/docker k8s.io/client-go
k8s.io/apimachinery sigs.k8s.io/controller-runtime github.com/golangci/golangci-lint github.com/air-verse/air
github.com/swaggo/swag github.com/cespare/xxhash/v2 github.com/dustin/go-humanize github.com/robfig/cron/v3
golang.org/x/time github.com/google/go-cmp github.com/davecgh/go-spew github.com/samber/lo
`

const PACKAGIST = `
laravel/framework laravel/laravel laravel/sanctum laravel/passport laravel/horizon laravel/telescope laravel/tinker
laravel/breeze laravel/jetstream laravel/socialite laravel/cashier laravel/scout laravel/octane laravel/sail
laravel/pint livewire/livewire inertiajs/inertia-laravel symfony/symfony symfony/console symfony/http-foundation
symfony/http-kernel symfony/routing symfony/yaml symfony/process symfony/finder symfony/filesystem
symfony/event-dispatcher symfony/dependency-injection symfony/var-dumper symfony/mailer symfony/serializer
symfony/validator symfony/form symfony/security-bundle symfony/twig-bundle symfony/framework-bundle
symfony/polyfill-mbstring symfony/polyfill-php80 symfony/dotenv symfony/cache symfony/translation
doctrine/orm doctrine/dbal doctrine/annotations doctrine/collections doctrine/inflector doctrine/migrations
doctrine/doctrine-bundle guzzlehttp/guzzle guzzlehttp/psr7 guzzlehttp/promises monolog/monolog
phpunit/phpunit mockery/mockery fakerphp/faker fzaninotto/faker pestphp/pest phpstan/phpstan
vimeo/psalm squizlabs/php_codesniffer friendsofphp/php-cs-fixer nikic/php-parser nesbot/carbon
ramsey/uuid vlucas/phpdotenv league/flysystem league/oauth2-client league/oauth2-server league/csv
league/commonmark firebase/php-jwt lcobucci/jwt twig/twig smarty/smarty psr/log psr/http-message
psr/container psr/cache psr/http-client php-http/discovery predis/predis aws/aws-sdk-php
stripe/stripe-php phpmailer/phpmailer swiftmailer/swiftmailer intervention/image spatie/laravel-permission
spatie/laravel-backup spatie/laravel-medialibrary barryvdh/laravel-debugbar barryvdh/laravel-dompdf
dompdf/dompdf tecnickcom/tcpdf phpoffice/phpspreadsheet maatwebsite/excel filp/whoops composer/composer
slim/slim cakephp/cakephp yiisoft/yii2 codeigniter4/framework wikimedia/composer-merge-plugin
`

function list(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

/** The comparable form of a name: case folded, and the separators a registry treats as equal made equal. */
export function canonical(name: string, eco: Ecosystem): string {
  if (eco === 'pypi') return normalizePypi(name)
  if (eco === 'crates') return name.toLowerCase().replace(/_/g, '-')
  return name.toLowerCase()
}

const LISTS: Record<Ecosystem, string[]> = {
  npm: list(NPM),
  pypi: list(PYPI),
  crates: list(CRATES),
  go: list(GO),
  rubygems: list(RUBYGEMS),
  packagist: list(PACKAGIST),
}

const CANON: Record<Ecosystem, Set<string>> = Object.fromEntries(
  (Object.keys(LISTS) as Ecosystem[]).map(eco => [eco, new Set(LISTS[eco].map(n => canonical(n, eco)))]),
) as Record<Ecosystem, Set<string>>

export function popularList(eco: Ecosystem): readonly string[] {
  return LISTS[eco]
}

export function isListedPopular(name: string, eco: Ecosystem): boolean {
  return CANON[eco].has(canonical(name, eco))
}

/** The namespace a name lives in, where the registry gives one: `@scope`, `vendor`, `host/owner`. */
function ownerOf(c: string, eco: Ecosystem): string | undefined {
  if (eco === 'npm') return c.startsWith('@') ? c.split('/')[0] : undefined
  if (eco === 'packagist') return c.split('/')[0]
  if (eco === 'go') return c.split('/').slice(0, 2).join('/')
  return undefined
}

/** Optimal string alignment distance (a swap of two neighbours counts as one edit), stopping early past `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0)
    row[0] = i
    return row
  })
  for (let j = 0; j < cols; j++) (d[0] as number[])[j] = j
  for (let i = 1; i < rows; i++) {
    let rowMin = Infinity
    const ri = d[i] as number[]
    const rp = d[i - 1] as number[]
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min((rp[j] as number) + 1, (ri[j - 1] as number) + 1, (rp[j - 1] as number) + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, ((d[i - 2] as number[])[j - 2] as number) + 1)
      }
      ri[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
  }
  return (d[rows - 1] as number[])[cols - 1] as number
}

/**
 * The popular package `name` looks like, when it is not one itself: one edit away for names of 4-7
 * characters, two for longer ones. Names under 4 characters are too short to judge.
 */
export function lookalikeOf(name: string, eco: Ecosystem): string | undefined {
  const c = canonical(name, eco)
  if (CANON[eco].has(c)) return undefined
  const owner = ownerOf(c, eco)
  let best: { name: string; d: number } | undefined
  for (const p of LISTS[eco]) {
    const pc = canonical(p, eco)
    if (pc.length < 4) continue
    // Inside one owner's namespace (an npm scope, a Packagist vendor, a Go host/owner) nobody else can publish.
    if (owner !== undefined && owner === ownerOf(pc, eco)) continue
    const max = pc.length >= 8 ? 2 : 1
    const d = editDistance(c, pc, max)
    if (d >= 1 && d <= max && (!best || d < best.d)) best = { name: p, d }
  }
  return best?.name
}
