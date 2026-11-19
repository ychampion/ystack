// Widely used npm and PyPI packages, for spotting look-alike (typosquat) names. Same lists as the
// Claude Code package-bouncer. A name is suspect when it is one or two edits away from one of these.

export const NPM = `
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

export const PYPI = `
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
