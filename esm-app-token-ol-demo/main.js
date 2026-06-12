/**
 * OpenLayers demo app using application credentials and a server component.
 * 2026年6月 ArcGIS Maps SDK for JavaScript の esm-app-token-demo をもとにOpenLayers にアレンジ
 */
import './style.css';
import Map from 'ol/Map';
import View from 'ol/View';
import { fromLonLat, toLonLat, transform } from 'ol/proj';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Style, Circle as CircleStyle, Fill, Stroke } from 'ol/style';

import Axios from 'axios';

import { apply } from 'ol-mapbox-style';

import { solveRoute } from '@esri/arcgis-rest-routing';
import { ApiKeyManager } from '@esri/arcgis-rest-request';


let tokenExpiration = null;
let lastGoodToken = null;

const mapStartLocation = [-116.5414418, 33.8258333];
const demoDestination = [-116.3697003, 33.7062298];

const appTokenURL = "http://localhost:3080/auth"; // The URL of the token server

// ArcGIS の graphic の代替として feature を追加してシンボル表示する
function addGraphic(type, coords, vectorLayer) {
    const feature = new Feature({
        geometry: new Point(fromLonLat(coords))
    });

    feature.setStyle(
        new Style({
            image: new CircleStyle({
                radius: 6,
                fill: new Fill({
                    color: (type === "start") ? "green" : "red"
                }),
                stroke: new Stroke({
                    color: "black",
                    width: 2
                })
            })
        })
    );

    vectorLayer.getSource().addFeature(feature);
}

// ArcGIS REST JS を使って出発地と目的地を指定してルートを表示する
async function getRoute(vectorLayer, token, map) {

    const source = vectorLayer.getSource();
    const features = source.getFeatures();

    if (features.length < 2) {
        console.error("at least two points");
        return;
    }

    const stops = features.map((f) => {
        const coord3857 = f.getGeometry().getCoordinates();
        // EPSG:3857 → EPSG:4326
        const [lon, lat] = transform(coord3857, "EPSG:3857", "EPSG:4326");
        return {
            x: lon,
            y: lat
        };
    })

    try {

        const authentication = ApiKeyManager.fromKey(token);
        const response = await solveRoute({
            stops,
            authentication: authentication,
            params: {
                directions: true
            }
        });

        const route = response.routes.features[0];
        const paths = route.geometry.paths[0];
        const coords = paths.map(([x, y]) =>
            fromLonLat([x, y])
        );

        const routeFeature = new Feature({
            geometry: new LineString(coords)
        });

        routeFeature.setStyle(
            new Style({
                stroke: new Stroke({
                    color: "blue",
                    width: 4
                })
            })
        );

        source.addFeature(routeFeature);

        showDirections(response.directions[0].features, map);

    }
    catch (e) {
        console.error("getRoute error:", e);
    }

}

// ルート検索結果の詳細をパネル表示
function showDirections(directions, map) {

    // --- 既存を消す（ArcGISの view.ui.empty 相当）
    clearDirections();

    // --- パネル作成
    const panel = document.createElement("div");
    panel.id = "directions-panel";

    panel.innerHTML = "<h3>Directions</h3>";

    // ArcGIS風スタイル
    panel.style.position = "absolute";
    panel.style.top = "10px";
    panel.style.right = "10px";
    panel.style.background = "white";
    panel.style.padding = "10px";
    panel.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
    panel.style.borderRadius = "4px";
    panel.style.maxHeight = "400px";
    panel.style.overflowY = "auto";
    panel.style.zIndex = 1000;

    // --- リスト作成
    const list = document.createElement("ol");

    directions.forEach((d) => {
        const li = document.createElement("li");
        const attr = d.attributes;

        li.textContent =
          attr.text +
          (attr.length > 0
          ? ` (${attr.length.toFixed(2)} miles)`
          : "");

        list.appendChild(li);
    });

    panel.appendChild(list);

    // map に重ねる
    map.getTargetElement().appendChild(panel);
}

// ルート検索結果のパネルを消去
function clearDirections() {
    const old = document.getElementById("directions-panel");
    if (old) old.remove();
}

// basemapstyle の url をトークン付きで生成する
function createBasemapURLWithToken(basemapId, token) {
    return `https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/${basemapId}?token=${token}`;
}

// 認証が完了したら Map と View を作成する
async function setupMapView(response) {
    
    const token = response?.access_token;

    // OpenLayers Map
    const map = new Map({
        target: "appDiv",
        //layers: [],
        view: new View({
            center: fromLonLat(mapStartLocation),
            zoom: 11
        })
    });

    const basemapId = "arcgis/navigation"; // "arcgis/streets"; //"arcgis/outdoor";
    const basemapURL = createBasemapURLWithToken(basemapId, token);

    //console.log("token:", token);
    //console.log("basemapURL:", basemapURL);
    //BasemapStyle に apiKey を設定する代わりに token 付きのURLでレイヤーを追加
    try {
        await apply(map, basemapURL);
        console.log("basemap loaded");
        const layer = map.getLayers().item(0);
        const source = layer.getSource();
        const poweredByEsriString =
          "Powered by <a href='https://www.esri.com/en-us/home' target='_blank'>Esri</a> | ";
        const attributionFn = source.getAttributions();
        if (attributionFn) {
            source.setAttributions((state) => {
                return [poweredByEsriString, ...attributionFn(state)];
            });
        } else {
            source.setAttributions(poweredByEsriString);
        }
    }
    catch (e) {
        console.error("olms failed:", e);
    }

    // Graphics用レイヤ（ArcGISの graphics の代替）
    const vectorSource = new VectorSource();
    const vectorLayer = new VectorLayer({
        source: vectorSource
    });
    map.addLayer(vectorLayer);

    // 初期ルート（centerを使う）
    addGraphic("start", mapStartLocation, vectorLayer);

    setTimeout(() => {
        addGraphic("finish", demoDestination, vectorLayer);
        getRoute(vectorLayer, token, map);
    }, 1000);

    //クリックイベント
    map.on("click", function (event) {
        const features = vectorSource.getFeatures();

        if (features.length === 0) {
            addGraphic("start", toLonLat(event.coordinate), vectorLayer);
        } else if (features.length === 1) {
            addGraphic("finish", toLonLat(event.coordinate), vectorLayer);
            getRoute(vectorLayer, token, map);
        } else {
            vectorSource.clear();
            clearDirections();
            addGraphic("start", toLonLat(event.coordinate), vectorLayer);
        }
    });

    // FeatureLayer相当（必要なら）
    // if (featureLayerURL) {
    //     const featureLayer = new ol.layer.Vector({
    //         source: new ol.source.Vector({
    //             url: (extent) => {
    //                 const sep = featureLayerURL.includes("?") ? "&" : "?";
    //                 return `${featureLayerURL}${sep}f=geojson&token=${token}`;
    //             },
    //             format: new ol.format.GeoJSON()
    //         })
    //     });
    //     map.addLayer(featureLayer);
    // }

}


// トークンを待つ
// 以前にトークンを取得しており有効期限が切れていない場合は、ローカルにキャッシュされているトークンを返す
// そうでない場合は、トークンサーバーに接続してトークンを取得する
async function requestApplicationToken() {
  // まだ有効ならそのまま返す
  if (tokenExpiration != null && Date.now() < tokenExpiration) {
    return lastGoodToken;
  }

  try {
    // トークンサーバーへ問い合わせ
    const session_id = 1234; // 必要ならサーバーで管理

    const response = await Axios.post(appTokenURL, {
      nonce: session_id
    });

    const responseData = response.data;

    // ArcGISは200でもerrorを返す
    if (responseData.error) {
      const error = new Error(responseData.error.message);
      error.code = responseData.error.code;
      throw error;
    }

    // トークン保存
    lastGoodToken = responseData;

    // 有効期限（ms）
    tokenExpiration = Date.now() + (responseData.expires_in * 1000);

    return lastGoodToken;

  } catch (error) {
      throw error;
  }

}


/**
 * エラー表示（OpenLayers用）
 * - トークン/通信エラー時に画面差し替え
 */
function showErrorMessage(error) {

  const app = document.getElementById("appDiv");
  if (!app) return;

  // エラーメッセージを安全に整形
  let message = "Unknown error";

  if (error) {
      if (error.message) {
          message = error.message;
      } else {
          message = JSON.stringify(error, null, 2);
      }
  }

  app.innerHTML = `
      <div style="padding:20px;">
          <h3>Cannot create map view</h3>
          <p>Received error from the auth service:</p>
          <pre style="background:#f5f5f5;padding:10px;border-radius:4px;">
${escapeHtml(message)}
</pre>
      </div>
  `;
}

/**
* HTMLエスケープ（XSS対策）
*/
function escapeHtml(str) {
  return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
}



// Get a token and render the map
// トークンを取得し、マップを表示する
async function init() {
  try {
      const response = await requestApplicationToken();
      await setupMapView(response);
  } catch (error) {
      showErrorMessage(error);
  }
}
init();
