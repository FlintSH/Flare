import DefaultTheme from 'vitepress/theme'

import Layout from './Layout.vue'

import ApiPlayground from './components/ApiPlayground.vue'
import DemoTour from './components/DemoTour.vue'
import FeatureExplorer from './components/FeatureExplorer.vue'
import Home from './components/Home.vue'
import Screenshot from './components/Screenshot.vue'
import RoleLab from './components/RoleLab.vue'
import UploadLab from './components/UploadLab.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    for (const [name, component] of Object.entries({
      Home,
      Screenshot,
      FeatureExplorer,
      DemoTour,
      UploadLab,
      RoleLab,
      ApiPlayground,
    })) {
      app.component(name, component)
    }
  },
}
