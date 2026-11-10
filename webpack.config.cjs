module.exports = {
 entry: './src/module.tsx',
 output: { filename: 'module.js', path: require('path').resolve(__dirname, 'dist'), library: {type: 'amd'}, publicPath: 'auto', clean: false },
 externals: ['react', 'react-dom', 'react/jsx-runtime', '@grafana/data', '@grafana/runtime', '@grafana/ui'],
 module: {rules: [{test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/}]},
 resolve: {extensions: ['.ts','.tsx','.js']},
};
